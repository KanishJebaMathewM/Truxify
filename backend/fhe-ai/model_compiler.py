class FheModelCompiler:
    """
    Compiles standard ML model weights into FHE-compatible integer matrix representations.
    """
    def __init__(self, precision_bits: int = 16):
        self.precision_bits = precision_bits
        self.quant_factor = 2 ** precision_bits

    def compile_linear_weights(self, weights: list, bias: float):
        quantized_weights = [int(w * self.quant_factor) for w in weights]
        quantized_bias = int(bias * self.quant_factor)
        return {
            "quantized_weights": quantized_weights,
            "quantized_bias": quantized_bias,
            "quant_factor": self.quant_factor
        }

compiler = FheModelCompiler()
