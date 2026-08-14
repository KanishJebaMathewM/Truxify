class BolItem {
  final String sku;
  final String description;
  final int quantity;
  final double weightLbs;

  BolItem({
    required this.sku,
    required this.description,
    required this.quantity,
    required this.weightLbs,
  });
}

class SmartContractBol {
  final String contractId;
  final String blockHash;
  final String shipper;
  final String receiver;
  final double payoutAmount;
  final String status; // "Awaiting Delivery", "Receiver Signing", "Contract Executed - Funds Released"
  final List<BolItem> items;

  SmartContractBol({
    required this.contractId,
    required this.blockHash,
    required this.shipper,
    required this.receiver,
    required this.payoutAmount,
    required this.status,
    required this.items,
  });
}
