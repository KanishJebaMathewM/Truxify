import torch
import torch.nn as nn

from . import models as _models


_BaseRouteOptimizer = _models.RouteOptimizer


class RouteOptimizer(_BaseRouteOptimizer):
    """Add an explicit validation pass to GNN training."""

    def train(self, train_data, val_data=None, epochs=100):
        """Train the GNN and evaluate validation data after every epoch."""
        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        criterion = nn.MSELoss()

        self.validation_history = []
        self.last_validation_loss = None
        avg_loss = 0.0

        for epoch in range(epochs):
            self.model.train()
            total_loss = 0.0
            for data in train_data:
                data = data.to(self.device)
                optimizer.zero_grad()
                out = self.model(data.x, data.edge_index, data.edge_attr, data.batch)
                loss = criterion(out, data.y)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()

            avg_loss = total_loss / len(train_data)
            avg_val_loss = None

            if val_data:
                self.model.eval()
                validation_total = 0.0
                with torch.no_grad():
                    for data in val_data:
                        data = data.to(self.device)
                        out = self.model(data.x, data.edge_index, data.edge_attr, data.batch)
                        validation_total += criterion(out, data.y).item()
                avg_val_loss = validation_total / len(val_data)
                self.last_validation_loss = avg_val_loss

            self.validation_history.append({
                "epoch": epoch + 1,
                "train_loss": avg_loss,
                "validation_loss": avg_val_loss,
            })

            if epoch % 10 == 0:
                if avg_val_loss is None:
                    _models.logger.info(f"Epoch {epoch}: Loss = {avg_loss:.4f}")
                else:
                    _models.logger.info(
                        f"Epoch {epoch}: Loss = {avg_loss:.4f}, "
                        f"Validation Loss = {avg_val_loss:.4f}"
                    )

        self.model.train()
        return avg_loss


_models.RouteOptimizer = RouteOptimizer
