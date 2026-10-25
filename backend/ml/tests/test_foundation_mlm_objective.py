"""Independent masked-token objectives and actual native optimizer controls."""

import copy

import numpy as np
import pytest
import torch
from foundation.data import LogisticsDataProcessor
from foundation.model import FoundationModelConfig, LogisticsFoundationModel
from foundation.pretraining import (
    IGNORE_INDEX,
    MaskedTokenTrainer,
    collate_mlm,
    masked_examples,
)


def setup_model(layers=1, batch_size=2):
    torch.manual_seed(73)
    config = FoundationModelConfig(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=layers,
        d_ff=16,
        max_len=6,
        dropout=0,
        epochs=1,
        batch_size=batch_size,
    )
    model = LogisticsFoundationModel(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=layers,
        d_ff=16,
        max_len=6,
        dropout=0,
    )
    return model, MaskedTokenTrainer(model, config)


def sample(tokens, labels):
    return {"tokens": tokens, "labels": labels, "pad_id": 0}


def test_special_ids_preserve_lexical_zero_and_loaded_vocabulary():
    p = LogisticsDataProcessor()
    p.vocab = {"delhi": 0, "mumbai": 1}
    data = [{"origin": "Delhi", "destination": "Mumbai", "cargo_type": "bulk"}]
    result = masked_examples(p, data, 1, np.random.default_rng(5))
    assert p.vocab["delhi"] == 0 and p.vocab["mumbai"] == 1
    assert p.vocab["[PAD]"] != p.vocab["[MASK]"]
    assert result[0]["labels"] == [0, 1, p.vocab["bulk"]]
    assert result[0]["tokens"] == [p.vocab["[MASK]"]] * 3
    data[0]["origin"] = "changed"
    assert result[0]["metadata"]["origin"] == "Delhi"


def test_unselected_targets_ignored_and_processor_delegates():
    p = LogisticsDataProcessor()
    data = [{"origin": "Delhi", "destination": "Mumbai"}]
    result = masked_examples(p, data, 0, np.random.default_rng(5))
    assert result[0]["labels"] == [IGNORE_INDEX] * 2
    assert result[0]["tokens"] == [p.vocab["delhi"], p.vocab["mumbai"]]
    np.random.seed(17)
    direct = p.create_pretraining_data(data)
    assert direct[0]["pad_id"] == p.vocab["[PAD]"]
    assert len(direct[0]["tokens"]) == len(direct[0]["labels"]) == 2


def test_partial_masks_match_independent_rng_selection():
    p = LogisticsDataProcessor()
    data = [{"origin": "a b c d e f g h"}]
    expected = np.random.default_rng(41).random(8) < 0.4
    result = masked_examples(p, data, 0.4, np.random.default_rng(41))[0]
    for i, selected in enumerate(expected):
        assert (result["labels"][i] != IGNORE_INDEX) == selected
        if selected:
            assert result["tokens"][i] == p.vocab["[MASK]"]
        else:
            assert result["tokens"][i] == p.vocab["abcdefgh"[i]]


def test_invalid_late_source_preserves_vocabulary_and_rng():
    p = LogisticsDataProcessor()
    rng = np.random.default_rng(5)
    prior = copy.deepcopy(rng.bit_generator.state)
    with pytest.raises(ValueError):
        masked_examples(p, [{"origin": "valid"}, {"origin": 3}], rng=rng)
    assert p.vocab == {} and rng.bit_generator.state == prior


def test_collator_padding_masks_lexical_zero_correctly():
    records = [sample([0, 2], [3, IGNORE_INDEX]), sample([4], [5])]
    batch = collate_mlm(records, 16, 6)
    assert batch["input_ids"].tolist() == [[0, 2], [4, 0]]
    assert batch["attention_mask"].tolist() == [[True, True], [True, False]]
    assert batch["labels"].tolist() == [[3, -100], [5, -100]]
    records[0]["tokens"][0] = 7
    assert batch["input_ids"][0, 0] == 0


def test_native_token_logits_and_legacy_generation_contract():
    model, _ = setup_model()
    ids = torch.tensor([[1, 2, 3], [4, 5, 0]])
    mask = torch.tensor([[1, 1, 1], [1, 1, 0]], dtype=torch.bool)
    assert model(ids, mask, task="mlm")["output"].shape == (2, 3, 16)
    assert model(ids, task="generation")["output"].shape == (2, 16)
    assert model(ids, task="classification")["output"].shape == (2, 2)


def test_loss_and_gradients_against_independent_selected_token_ce():
    model, trainer = setup_model()
    model.eval()
    batch = collate_mlm([sample([1, 2, 3], [4, -100, 5]), sample([1], [6])], 16, 6)
    loss, count = trainer._forward_loss(batch)
    logits = model(batch["input_ids"], batch["attention_mask"], task="mlm")["output"]
    selected = logits[batch["labels"] != -100]
    targets = batch["labels"][batch["labels"] != -100]
    manual = (
        torch.logsumexp(selected, dim=-1)
        - selected.gather(1, targets[:, None]).squeeze(1)
    ).mean()
    assert count == 3
    torch.testing.assert_close(loss, manual)
    left = torch.autograd.grad(loss, model.generation_head.weight, retain_graph=True)[0]
    right = torch.autograd.grad(manual, model.generation_head.weight)[0]
    torch.testing.assert_close(left, right)


def test_actual_optimizer_updates_generation_not_classification_head():
    model, trainer = setup_model()
    head = model.generation_head.weight.detach().clone()
    classifier = model.classification_head.weight.detach().clone()
    records = [sample([1, 2, 3], [4, -100, 5]), sample([1], [6])]
    prior = copy.deepcopy(records)
    result = trainer.train_step(records)
    assert result["supervised_tokens"] == 3 and np.isfinite(result["loss"])
    assert not torch.equal(head, model.generation_head.weight)
    torch.testing.assert_close(classifier, model.classification_head.weight)
    assert records == prior


def test_empty_supervision_preserves_all_training_state_and_mode():
    model, trainer = setup_model()
    model.eval()
    prior = {k: v.clone() for k, v in model.state_dict().items()}
    scheduler = copy.deepcopy(trainer.scheduler.state_dict())
    result = trainer.train_step([sample([1, 2], [-100, -100])])
    assert result == {"loss": 0.0, "supervised_tokens": 0}
    assert trainer.optimizer.state == {} and trainer.scheduler.state_dict() == scheduler
    assert not model.training
    for k, v in model.state_dict().items():
        torch.testing.assert_close(v, prior[k])
    trainer.train([sample([1, 2], [-100, -100])])
    assert trainer.optimizer.state == {} and trainer.scheduler.state_dict() == scheduler


def test_validation_token_weighting_independent_of_batch_partition():
    model, trainer = setup_model()
    model.train()
    data = [sample([1, 2, 3], [4, 5, 6]), sample([1], [7]), sample([2, 3], [-100, 8])]
    trainer.batch_size = 1
    one = trainer.validate(data)
    trainer.batch_size = 3
    all_ = trainer.validate(data)
    assert one == pytest.approx(all_, rel=1e-6)
    assert model.training


@pytest.mark.parametrize(
    "record",
    [
        sample([], []),
        sample([1], [2, 3]),
        sample([16], [2]),
        sample([True], [2]),
        sample([1], [16]),
        sample([1], [-1]),
        sample([1] * 7, [2] * 7),
        {"tokens": [1], "labels": [2], "pad_id": True},
        {"tokens": ["1"], "labels": [2], "pad_id": 0},
    ],
)
def test_invalid_record_rejected_before_optimizer(record):
    model, trainer = setup_model()
    prior = model.generation_head.weight.detach().clone()
    with pytest.raises(ValueError):
        trainer.train_step([record])
    assert trainer.optimizer.state == {}
    torch.testing.assert_close(model.generation_head.weight, prior)


def test_invalid_late_training_or_validation_data_precedes_updates():
    _model, trainer = setup_model(batch_size=1)
    good = sample([1], [2])
    bad = sample([19], [2])
    for train, val in (([good, bad], None), ([good], [bad])):
        with pytest.raises(ValueError):
            trainer.train(train, val)
        assert trainer.optimizer.state == {}


def test_train_reports_finite_token_objective_without_source_mutation():
    _model, trainer = setup_model()
    records = [sample([1, 2], [3, 4]), sample([1], [5])]
    prior = copy.deepcopy(records)
    result = trainer.train(records, records)
    assert np.isfinite(result["final_train_loss"]) and np.isfinite(
        result["final_val_loss"]
    )
    assert records == prior and trainer.scheduler.last_epoch == 1


def test_padding_invariance_of_valid_token_logits():
    model, _trainer = setup_model()
    model.eval()
    alone = collate_mlm([sample([1], [4])], 16, 6)
    paired = collate_mlm([sample([1], [4]), sample([2, 3, 5], [6, 7, 8])], 16, 6)
    first = model(alone["input_ids"], alone["attention_mask"], task="mlm")["output"][
        0, 0
    ]
    second = model(paired["input_ids"], paired["attention_mask"], task="mlm")["output"][
        0, 0
    ]
    torch.testing.assert_close(first, second)


@pytest.mark.parametrize("probability", [-0.1, 1.1, float("nan"), True, "0.2"])
def test_invalid_mask_policy_before_vocabulary_growth(probability):
    processor = LogisticsDataProcessor()
    with pytest.raises(ValueError):
        masked_examples(processor, [{"origin": "Delhi"}], probability)
    assert processor.vocab == {}


@pytest.mark.parametrize("vocab", [{"a": 0, "b": 0}, {"a": 3}, {"a": True}, {"a": "0"}])
def test_invalid_vocabulary_rejected(vocab):
    processor = LogisticsDataProcessor()
    processor.vocab = copy.deepcopy(vocab)
    with pytest.raises(ValueError):
        masked_examples(processor, [{"origin": "Delhi"}])
    assert processor.vocab == vocab


def test_native_existing_checkpoint_reloads_mlm_head(tmp_path):
    from foundation.model import FoundationModelTrainer

    model, trainer = setup_model()
    records = [sample([1, 2], [3, 4])]
    trainer.train_step(records)
    model.eval()
    ids = torch.tensor([[1, 2]])
    expected = model(ids, task="mlm")["output"].detach().clone()
    legacy = FoundationModelTrainer(model, trainer.config)
    legacy.save(str(tmp_path / "existing.pth"))
    restored, new_trainer = setup_model()
    FoundationModelTrainer(restored, new_trainer.config).load(
        str(tmp_path / "existing.pth")
    )
    restored.eval()
    torch.testing.assert_close(restored(ids, task="mlm")["output"], expected)
