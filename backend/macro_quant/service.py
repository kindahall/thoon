from __future__ import annotations

from macro_quant.allocation import AllocationEngine
from macro_quant.correlation import CorrelationEngine
from macro_quant.data_engine import CrossAssetDataEngine
from macro_quant.regime import MacroRegimeDetector
from macro_quant.schemas import CrossAssetMacroOutput, CrossAssetMacroRequest
from macro_quant.signal_fusion import SignalFusionEngine


class CrossAssetMacroTradingSystem:
    def __init__(
        self,
        *,
        data_engine: CrossAssetDataEngine | None = None,
        correlation_engine: CorrelationEngine | None = None,
        regime_detector: MacroRegimeDetector | None = None,
        signal_fusion: SignalFusionEngine | None = None,
        allocation_engine: AllocationEngine | None = None,
    ) -> None:
        self.data_engine = data_engine or CrossAssetDataEngine()
        self.correlation_engine = correlation_engine or CorrelationEngine()
        self.regime_detector = regime_detector or MacroRegimeDetector()
        self.signal_fusion = signal_fusion or SignalFusionEngine()
        self.allocation_engine = allocation_engine or AllocationEngine()

    async def analyze(self, request: CrossAssetMacroRequest) -> CrossAssetMacroOutput:
        aligned, _macro_frame, _snapshots = await self.data_engine.load(request)
        macro_columns = ["DXY_PROXY", "US10Y", "US2Y", "FEDFUNDS", "CPI"]
        correlations = self.correlation_engine.calculate(
            aligned=aligned,
            crypto_symbols=request.symbols,
            macro_columns=macro_columns,
            window=request.correlation_window,
            breakdown_threshold=request.breakdown_threshold,
        )
        macro_regime, regime_scores, _regime_mask = self.regime_detector.detect(
            aligned=aligned,
            crypto_symbols=request.symbols,
        )
        signal_score, risk_score, confidence = self.signal_fusion.score(
            aligned=aligned,
            crypto_symbols=request.symbols,
            macro_regime=macro_regime,
            regime_scores=regime_scores,
            correlations=correlations,
        )
        allocation = self.allocation_engine.allocate(
            request=request,
            aligned=aligned,
            macro_regime=macro_regime,
            signal_score=signal_score,
            risk_score=risk_score,
        )
        return CrossAssetMacroOutput(
            macro_regime=macro_regime,
            correlations=correlations,
            allocation=allocation,
            risk_score=risk_score,
            confidence=confidence,
        )
