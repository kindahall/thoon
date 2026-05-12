'use client';

import { useEffect, useMemo, useRef, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from 'lightweight-charts';

import type { Candle } from '../../types/market';
import { useTheme } from '../../hooks/useTheme';
import { sanitizeCandles } from '../../utils/candles';
import {
  adxSeries,
  aroonSeries,
  atrSeries,
  bollingerBands,
  cciSeries,
  cmfSeries,
  donchianChannel,
  exponentialAverageSeries,
  hullMovingAverageSeries,
  ichimokuLines,
  keltnerChannel,
  macdSeries,
  mfiSeries,
  momentumSeries,
  movingAverageSeries,
  normalizeChartIndicatorConfig,
  obvSeries,
  parabolicSarSeries,
  rocSeries,
  rsiSeries,
  stochasticSeries,
  stochRsiSeries,
  supertrendSeries,
  trixSeries,
  volumeWeightedMovingAverageSeries,
  vwapSeries,
  weightedMovingAverageSeries,
  williamsRSeries,
  type ChartIndicatorConfig,
  type IndicatorPoint,
} from '../../utils/chart-indicators';
import { formatUsd } from '../../utils/format';

export type { ChartIndicatorConfig };

type TradingChartProps = {
  activeDrawingTool?: ChartDrawingType;
  activeMarkerLabel?: string;
  activeMarkerType?: TradeMarkerType;
  candles: Candle[];
  dataIdentity: string;
  drawings: ChartDrawing[];
  fallbackPrice: number;
  indicators: ChartIndicatorConfig;
  onAddDrawing: (type: ChartDrawingType, price: number) => void;
  markers: TradeMarker[];
  onRemoveDrawing: (id: string) => void;
  onDropMarker: (type: TradeMarkerType, price: number) => void;
  onRemoveMarker: (id: string) => void;
  onUpdateMarkerPrice: (id: string, price: number) => void;
  positionPreview?: PositionPreview;
};

export type TradeMarkerType = 'entry' | 'exit' | 'stopLoss' | 'takeProfit' | 'tp2' | 'buyLimit' | 'sellLimit' | 'alert';

export type TradeMarker = {
  color: string;
  id: string;
  label: string;
  price: number;
  type: TradeMarkerType;
};

export type ChartDrawingType = 'line' | 'zone';

export type ChartDrawing = {
  color: string;
  id: string;
  label: string;
  lowerPrice?: number;
  price: number;
  type: ChartDrawingType;
  upperPrice?: number;
};

type PositionPreview = {
  direction: 'long' | 'short';
  entry: number;
  riskReward: number;
  stopLoss: number;
  takeProfit: number;
};

export function TradingChart({
  activeDrawingTool,
  activeMarkerLabel,
  activeMarkerType,
  candles,
  dataIdentity,
  drawings,
  fallbackPrice,
  indicators,
  markers,
  onAddDrawing,
  onDropMarker,
  onRemoveDrawing,
  onRemoveMarker,
  onUpdateMarkerPrice,
  positionPreview,
}: TradingChartProps) {
  const chartCandles = useMemo(() => sanitizeCandles(candles), [candles]);
  const activeIndicators = useMemo(() => normalizeChartIndicatorConfig(indicators), [indicators]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const adxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aroonDownSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const aroonUpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const atrSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cciSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cmfSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const donchianLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const donchianMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const donchianUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ichimokuBaseSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ichimokuConversionSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ichimokuSpanASeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ichimokuSpanBSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const keltnerLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const keltnerMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const keltnerUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maFastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maSlowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const mfiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const momentumSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const obvSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const parabolicSarSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rocSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const stochasticDSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const stochasticKSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const stochRsiDSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const stochRsiKSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const supertrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const trixSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const williamsRSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const wmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const fittedDataIdentityRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const priceRange = resolvePriceRange(chartCandles, markers, drawings);
  const firstCandleTime = chartCandles[0]?.time ?? 'empty';
  const lastCandleTime = chartCandles[chartCandles.length - 1]?.time ?? 'empty';
  const dataWindowIdentity = `${dataIdentity}:${chartCandles.length}:${firstCandleTime}:${lastCandleTime}`;

  useEffect(() => {
    if (!surfaceRef.current) {
      return;
    }

    const isLight = resolvedTheme === 'light';
    const gridColor = isLight ? 'rgba(3, 117, 164, 0.09)' : 'rgba(116, 207, 255, 0.09)';
    const textColor = isLight ? '#647084' : '#88a1bc';
    const borderColor = isLight ? 'rgba(5, 122, 173, 0.18)' : 'rgba(104, 219, 255, 0.18)';
    const crosshairColor = isLight ? 'rgba(3, 117, 164, 0.42)' : 'rgba(126, 221, 255, 0.42)';

    const chart = createChart(surfaceRef.current, {
      autoSize: true,
      handleScale: {
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        horzTouchDrag: true,
        mouseWheel: true,
        pressedMouseMove: true,
        vertTouchDrag: true,
      },
      layout: {
        attributionLogo: false,
        background: { color: 'transparent', type: ColorType.Solid },
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        textColor,
      },
      grid: {
        horzLines: { color: gridColor },
        vertLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { color: crosshairColor, labelBackgroundColor: '#26c8ff', width: 1 },
        vertLine: { color: crosshairColor, labelBackgroundColor: '#26c8ff', width: 1 },
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { bottom: 0.24, top: 0.08 },
      },
      timeScale: {
        barSpacing: 9,
        borderColor,
        fixLeftEdge: false,
        fixRightEdge: false,
        minBarSpacing: 5,
        rightOffset: 8,
        timeVisible: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      borderVisible: false,
      downColor: '#ff5f75',
      lastValueVisible: true,
      priceLineColor: '#26c8ff',
      priceLineStyle: LineStyle.Solid,
      priceLineVisible: true,
      priceLineWidth: 1,
      upColor: '#62e6a8',
      wickDownColor: '#ff6d80',
      wickUpColor: '#62e6a8',
    });

    const addLineSeries = (color: string, priceScaleId?: string, lineWidth: 1 | 2 = 2, lineStyle?: LineStyle) =>
      chart.addSeries(LineSeries, {
        color,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        lineStyle,
        lineWidth,
        priceLineVisible: false,
        priceScaleId,
      });

    const maFastSeries = addLineSeries(isLight ? 'rgba(3, 143, 196, 0.78)' : 'rgba(38, 200, 255, 0.82)');
    const maSlowSeries = addLineSeries(isLight ? 'rgba(186, 122, 0, 0.82)' : 'rgba(255, 212, 90, 0.78)');
    const emaSeries = addLineSeries(isLight ? 'rgba(145, 90, 255, 0.78)' : 'rgba(165, 108, 255, 0.82)');
    const wmaSeries = addLineSeries(isLight ? 'rgba(255, 122, 200, 0.72)' : 'rgba(255, 122, 200, 0.78)');
    const hmaSeries = addLineSeries(isLight ? 'rgba(53, 213, 255, 0.76)' : 'rgba(53, 213, 255, 0.82)');
    const vwmaSeries = addLineSeries(isLight ? 'rgba(0, 154, 115, 0.72)' : 'rgba(100, 244, 210, 0.74)');
    const vwapSeries = addLineSeries(isLight ? 'rgba(0, 154, 115, 0.74)' : 'rgba(98, 230, 168, 0.74)');
    const bollingerUpperSeries = addLineSeries('rgba(38, 200, 255, 0.62)', undefined, 1);
    const bollingerMiddleSeries = addLineSeries('rgba(38, 200, 255, 0.44)', undefined, 1, LineStyle.Dotted);
    const bollingerLowerSeries = addLineSeries('rgba(38, 200, 255, 0.62)', undefined, 1);
    const donchianUpperSeries = addLineSeries('rgba(255, 212, 90, 0.56)', undefined, 1);
    const donchianMiddleSeries = addLineSeries('rgba(255, 212, 90, 0.34)', undefined, 1, LineStyle.Dotted);
    const donchianLowerSeries = addLineSeries('rgba(255, 212, 90, 0.56)', undefined, 1);
    const keltnerUpperSeries = addLineSeries('rgba(165, 108, 255, 0.52)', undefined, 1);
    const keltnerMiddleSeries = addLineSeries('rgba(165, 108, 255, 0.34)', undefined, 1, LineStyle.Dotted);
    const keltnerLowerSeries = addLineSeries('rgba(165, 108, 255, 0.52)', undefined, 1);
    const ichimokuConversionSeries = addLineSeries('rgba(38, 200, 255, 0.66)', undefined, 1);
    const ichimokuBaseSeries = addLineSeries('rgba(255, 95, 117, 0.66)', undefined, 1);
    const ichimokuSpanASeries = addLineSeries('rgba(98, 230, 168, 0.48)', undefined, 1);
    const ichimokuSpanBSeries = addLineSeries('rgba(255, 212, 90, 0.48)', undefined, 1);
    const supertrendSeries = addLineSeries('rgba(98, 230, 168, 0.86)', undefined, 2);
    const parabolicSarSeries = addLineSeries('rgba(255, 184, 107, 0.78)', undefined, 1, LineStyle.Dotted);
    const rsiSeries = addLineSeries('rgba(38, 200, 255, 0.9)', 'oscillator');
    const stochasticKSeries = addLineSeries('rgba(98, 230, 168, 0.86)', 'oscillator');
    const stochasticDSeries = addLineSeries('rgba(255, 212, 90, 0.86)', 'oscillator');
    const stochRsiKSeries = addLineSeries('rgba(53, 213, 255, 0.82)', 'oscillator');
    const stochRsiDSeries = addLineSeries('rgba(255, 122, 200, 0.82)', 'oscillator');
    const cciSeries = addLineSeries('rgba(165, 108, 255, 0.84)', 'oscillator');
    const williamsRSeries = addLineSeries('rgba(255, 184, 107, 0.84)', 'oscillator');
    const rocSeries = addLineSeries('rgba(100, 244, 210, 0.82)', 'oscillator');
    const momentumSeries = addLineSeries('rgba(255, 95, 117, 0.78)', 'oscillator');
    const trixSeries = addLineSeries('rgba(38, 200, 255, 0.78)', 'oscillator');
    const atrSeries = addLineSeries('rgba(255, 212, 90, 0.78)', 'oscillator');
    const macdLineSeries = addLineSeries('rgba(38, 200, 255, 0.86)', 'oscillator');
    const macdSignalSeries = addLineSeries('rgba(255, 212, 90, 0.86)', 'oscillator');
    const obvSeries = addLineSeries('rgba(98, 230, 168, 0.76)', 'oscillator');
    const mfiSeries = addLineSeries('rgba(100, 244, 210, 0.82)', 'oscillator');
    const cmfSeries = addLineSeries('rgba(255, 184, 107, 0.82)', 'oscillator');
    const adxSeries = addLineSeries('rgba(165, 108, 255, 0.86)', 'oscillator');
    const aroonUpSeries = addLineSeries('rgba(98, 230, 168, 0.76)', 'oscillator');
    const aroonDownSeries = addLineSeries('rgba(255, 95, 117, 0.76)', 'oscillator');

    const volumeSeries = chart.addSeries(HistogramSeries, {
      lastValueVisible: false,
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      priceScaleId: 'volume',
    });

    const macdHistogramSeries = chart.addSeries(HistogramSeries, {
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'oscillator',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { bottom: 0, top: 0.78 },
    });
    chart.priceScale('oscillator').applyOptions({
      scaleMargins: { bottom: 0.08, top: 0.72 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    adxSeriesRef.current = adxSeries;
    aroonDownSeriesRef.current = aroonDownSeries;
    aroonUpSeriesRef.current = aroonUpSeries;
    atrSeriesRef.current = atrSeries;
    bollingerLowerSeriesRef.current = bollingerLowerSeries;
    bollingerMiddleSeriesRef.current = bollingerMiddleSeries;
    bollingerUpperSeriesRef.current = bollingerUpperSeries;
    cciSeriesRef.current = cciSeries;
    cmfSeriesRef.current = cmfSeries;
    donchianLowerSeriesRef.current = donchianLowerSeries;
    donchianMiddleSeriesRef.current = donchianMiddleSeries;
    donchianUpperSeriesRef.current = donchianUpperSeries;
    emaSeriesRef.current = emaSeries;
    hmaSeriesRef.current = hmaSeries;
    ichimokuBaseSeriesRef.current = ichimokuBaseSeries;
    ichimokuConversionSeriesRef.current = ichimokuConversionSeries;
    ichimokuSpanASeriesRef.current = ichimokuSpanASeries;
    ichimokuSpanBSeriesRef.current = ichimokuSpanBSeries;
    keltnerLowerSeriesRef.current = keltnerLowerSeries;
    keltnerMiddleSeriesRef.current = keltnerMiddleSeries;
    keltnerUpperSeriesRef.current = keltnerUpperSeries;
    maFastSeriesRef.current = maFastSeries;
    maSlowSeriesRef.current = maSlowSeries;
    macdHistogramSeriesRef.current = macdHistogramSeries;
    macdLineSeriesRef.current = macdLineSeries;
    macdSignalSeriesRef.current = macdSignalSeries;
    mfiSeriesRef.current = mfiSeries;
    momentumSeriesRef.current = momentumSeries;
    obvSeriesRef.current = obvSeries;
    parabolicSarSeriesRef.current = parabolicSarSeries;
    rocSeriesRef.current = rocSeries;
    rsiSeriesRef.current = rsiSeries;
    stochasticDSeriesRef.current = stochasticDSeries;
    stochasticKSeriesRef.current = stochasticKSeries;
    stochRsiDSeriesRef.current = stochRsiDSeries;
    stochRsiKSeriesRef.current = stochRsiKSeries;
    supertrendSeriesRef.current = supertrendSeries;
    trixSeriesRef.current = trixSeries;
    vwapSeriesRef.current = vwapSeries;
    vwmaSeriesRef.current = vwmaSeries;
    williamsRSeriesRef.current = williamsRSeries;
    wmaSeriesRef.current = wmaSeries;
    volumeSeriesRef.current = volumeSeries;
    fittedDataIdentityRef.current = null;

    return () => {
      priceLineRefs.current = [];
      chartRef.current = null;
      candleSeriesRef.current = null;
      adxSeriesRef.current = null;
      aroonDownSeriesRef.current = null;
      aroonUpSeriesRef.current = null;
      atrSeriesRef.current = null;
      bollingerLowerSeriesRef.current = null;
      bollingerMiddleSeriesRef.current = null;
      bollingerUpperSeriesRef.current = null;
      cciSeriesRef.current = null;
      cmfSeriesRef.current = null;
      donchianLowerSeriesRef.current = null;
      donchianMiddleSeriesRef.current = null;
      donchianUpperSeriesRef.current = null;
      emaSeriesRef.current = null;
      hmaSeriesRef.current = null;
      ichimokuBaseSeriesRef.current = null;
      ichimokuConversionSeriesRef.current = null;
      ichimokuSpanASeriesRef.current = null;
      ichimokuSpanBSeriesRef.current = null;
      keltnerLowerSeriesRef.current = null;
      keltnerMiddleSeriesRef.current = null;
      keltnerUpperSeriesRef.current = null;
      maFastSeriesRef.current = null;
      maSlowSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      mfiSeriesRef.current = null;
      momentumSeriesRef.current = null;
      obvSeriesRef.current = null;
      parabolicSarSeriesRef.current = null;
      rocSeriesRef.current = null;
      rsiSeriesRef.current = null;
      stochasticDSeriesRef.current = null;
      stochasticKSeriesRef.current = null;
      stochRsiDSeriesRef.current = null;
      stochRsiKSeriesRef.current = null;
      supertrendSeriesRef.current = null;
      trixSeriesRef.current = null;
      vwapSeriesRef.current = null;
      vwmaSeriesRef.current = null;
      williamsRSeriesRef.current = null;
      wmaSeriesRef.current = null;
      volumeSeriesRef.current = null;
      chart.remove();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;

    if (!candleSeries) {
      return;
    }

    candleSeries.setData(toCandlestickData(chartCandles));
    maFastSeriesRef.current?.setData(activeIndicators.maFast.enabled ? toLineData(movingAverageSeries(chartCandles, activeIndicators.maFast.period)) : []);
    maSlowSeriesRef.current?.setData(activeIndicators.maSlow.enabled ? toLineData(movingAverageSeries(chartCandles, activeIndicators.maSlow.period)) : []);
    emaSeriesRef.current?.setData(activeIndicators.ema.enabled ? toLineData(exponentialAverageSeries(chartCandles, activeIndicators.ema.period)) : []);
    wmaSeriesRef.current?.setData(activeIndicators.wma.enabled ? toLineData(weightedMovingAverageSeries(chartCandles, activeIndicators.wma.period)) : []);
    hmaSeriesRef.current?.setData(activeIndicators.hma.enabled ? toLineData(hullMovingAverageSeries(chartCandles, activeIndicators.hma.period)) : []);
    vwmaSeriesRef.current?.setData(activeIndicators.vwma.enabled ? toLineData(volumeWeightedMovingAverageSeries(chartCandles, activeIndicators.vwma.period)) : []);
    vwapSeriesRef.current?.setData(activeIndicators.vwap.enabled ? toLineData(vwapSeries(chartCandles)) : []);
    volumeSeriesRef.current?.setData(activeIndicators.volume.enabled ? toVolumeData(chartCandles) : []);

    const bollinger = activeIndicators.bollinger.enabled ? bollingerBands(chartCandles, activeIndicators.bollinger.period, activeIndicators.bollinger.stdDev) : [];
    bollingerUpperSeriesRef.current?.setData(toLineData(bollinger.map((point) => ({ time: point.time, value: point.upper }))));
    bollingerMiddleSeriesRef.current?.setData(toLineData(bollinger.map((point) => ({ time: point.time, value: point.middle }))));
    bollingerLowerSeriesRef.current?.setData(toLineData(bollinger.map((point) => ({ time: point.time, value: point.lower }))));

    const donchian = activeIndicators.donchian.enabled ? donchianChannel(chartCandles, activeIndicators.donchian.period) : [];
    donchianUpperSeriesRef.current?.setData(toLineData(donchian.map((point) => ({ time: point.time, value: point.upper }))));
    donchianMiddleSeriesRef.current?.setData(toLineData(donchian.map((point) => ({ time: point.time, value: point.middle }))));
    donchianLowerSeriesRef.current?.setData(toLineData(donchian.map((point) => ({ time: point.time, value: point.lower }))));

    const keltner = activeIndicators.keltner.enabled ? keltnerChannel(chartCandles, activeIndicators.keltner.period, activeIndicators.keltner.multiplier) : [];
    keltnerUpperSeriesRef.current?.setData(toLineData(keltner.map((point) => ({ time: point.time, value: point.upper }))));
    keltnerMiddleSeriesRef.current?.setData(toLineData(keltner.map((point) => ({ time: point.time, value: point.middle }))));
    keltnerLowerSeriesRef.current?.setData(toLineData(keltner.map((point) => ({ time: point.time, value: point.lower }))));

    const ichimoku = activeIndicators.ichimoku.enabled ? ichimokuLines(chartCandles, activeIndicators.ichimoku.conversionPeriod, activeIndicators.ichimoku.basePeriod, activeIndicators.ichimoku.spanBPeriod) : [];
    ichimokuConversionSeriesRef.current?.setData(toLineData(ichimoku.map((point) => ({ time: point.time, value: point.conversion }))));
    ichimokuBaseSeriesRef.current?.setData(toLineData(ichimoku.map((point) => ({ time: point.time, value: point.base }))));
    ichimokuSpanASeriesRef.current?.setData(toLineData(ichimoku.map((point) => ({ time: point.time, value: point.spanA }))));
    ichimokuSpanBSeriesRef.current?.setData(toLineData(ichimoku.map((point) => ({ time: point.time, value: point.spanB }))));

    supertrendSeriesRef.current?.setData(activeIndicators.supertrend.enabled ? toLineData(supertrendSeries(chartCandles, activeIndicators.supertrend.period, activeIndicators.supertrend.multiplier)) : []);
    parabolicSarSeriesRef.current?.setData(activeIndicators.parabolicSar.enabled ? toLineData(parabolicSarSeries(chartCandles, activeIndicators.parabolicSar.step, activeIndicators.parabolicSar.max)) : []);
    atrSeriesRef.current?.setData(activeIndicators.atr.enabled ? toLineData(atrSeries(chartCandles, activeIndicators.atr.period)) : []);
    rsiSeriesRef.current?.setData(activeIndicators.rsi.enabled ? toLineData(rsiSeries(chartCandles, activeIndicators.rsi.period)) : []);
    cciSeriesRef.current?.setData(activeIndicators.cci.enabled ? toLineData(cciSeries(chartCandles, activeIndicators.cci.period)) : []);
    williamsRSeriesRef.current?.setData(activeIndicators.williamsR.enabled ? toLineData(williamsRSeries(chartCandles, activeIndicators.williamsR.period)) : []);
    rocSeriesRef.current?.setData(activeIndicators.roc.enabled ? toLineData(rocSeries(chartCandles, activeIndicators.roc.period)) : []);
    momentumSeriesRef.current?.setData(activeIndicators.momentum.enabled ? toLineData(momentumSeries(chartCandles, activeIndicators.momentum.period)) : []);
    trixSeriesRef.current?.setData(activeIndicators.trix.enabled ? toLineData(trixSeries(chartCandles, activeIndicators.trix.period)) : []);
    obvSeriesRef.current?.setData(activeIndicators.obv.enabled ? toLineData(obvSeries(chartCandles)) : []);
    mfiSeriesRef.current?.setData(activeIndicators.mfi.enabled ? toLineData(mfiSeries(chartCandles, activeIndicators.mfi.period)) : []);
    cmfSeriesRef.current?.setData(activeIndicators.cmf.enabled ? toLineData(cmfSeries(chartCandles, activeIndicators.cmf.period)) : []);
    adxSeriesRef.current?.setData(activeIndicators.adx.enabled ? toLineData(adxSeries(chartCandles, activeIndicators.adx.period)) : []);

    const stochastic = activeIndicators.stochastic.enabled ? stochasticSeries(chartCandles, activeIndicators.stochastic.kPeriod, activeIndicators.stochastic.dPeriod) : undefined;
    stochasticKSeriesRef.current?.setData(stochastic ? toLineData(stochastic.k) : []);
    stochasticDSeriesRef.current?.setData(stochastic ? toLineData(stochastic.d) : []);

    const stochRsi = activeIndicators.stochRsi.enabled ? stochRsiSeries(chartCandles, activeIndicators.stochRsi.rsiPeriod, activeIndicators.stochRsi.stochPeriod, activeIndicators.stochRsi.dPeriod) : undefined;
    stochRsiKSeriesRef.current?.setData(stochRsi ? toLineData(stochRsi.k) : []);
    stochRsiDSeriesRef.current?.setData(stochRsi ? toLineData(stochRsi.d) : []);

    const macd = activeIndicators.macd.enabled ? macdSeries(chartCandles, activeIndicators.macd.fastPeriod, activeIndicators.macd.slowPeriod, activeIndicators.macd.signalPeriod) : undefined;
    macdLineSeriesRef.current?.setData(macd ? toLineData(macd.line) : []);
    macdSignalSeriesRef.current?.setData(macd ? toLineData(macd.signal) : []);
    macdHistogramSeriesRef.current?.setData(macd ? toHistogramData(macd.histogram) : []);

    const aroon = activeIndicators.aroon.enabled ? aroonSeries(chartCandles, activeIndicators.aroon.period) : [];
    aroonUpSeriesRef.current?.setData(toLineData(aroon.map((point) => ({ time: point.time, value: point.up }))));
    aroonDownSeriesRef.current?.setData(toLineData(aroon.map((point) => ({ time: point.time, value: point.down }))));

    if (fittedDataIdentityRef.current !== dataWindowIdentity) {
      fittedDataIdentityRef.current = dataWindowIdentity;
      chartRef.current?.timeScale().fitContent();
    }
  }, [activeIndicators, chartCandles, dataWindowIdentity]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;

    if (!candleSeries) {
      return;
    }

    priceLineRefs.current.forEach((priceLine) => {
      candleSeries.removePriceLine(priceLine);
    });

    priceLineRefs.current = markers.map((marker) =>
      candleSeries.createPriceLine({
        axisLabelColor: marker.color,
        axisLabelTextColor: '#ffffff',
        color: marker.color,
        lineStyle: marker.type === 'entry' ? LineStyle.Solid : LineStyle.Dashed,
        lineWidth: 1,
        price: marker.price,
        title: marker.label,
      }),
    );
  }, [markers, resolvedTheme]);

  function priceFromClientY(clientY: number) {
    const bounds = surfaceRef.current?.getBoundingClientRect();

    if (!bounds) {
      return fallbackPrice;
    }

    const coordinate = clientY - bounds.top;
    const chartPrice = candleSeriesRef.current?.coordinateToPrice(coordinate);

    if (typeof chartPrice === 'number' && Number.isFinite(chartPrice)) {
      return roundPrice(chartPrice);
    }

    const ratio = Math.min(1, Math.max(0, coordinate / bounds.height));
    return roundPrice(priceRange.max - ratio * (priceRange.max - priceRange.min));
  }

  function handleChartClick(event: MouseEvent<HTMLDivElement>) {
    if (!activeMarkerType) {
      if (activeDrawingTool) {
        onAddDrawing(activeDrawingTool, priceFromClientY(event.clientY));
      }

      return;
    }

    onDropMarker(activeMarkerType, priceFromClientY(event.clientY));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-thoon-marker') as TradeMarkerType;

    if (!type) {
      return;
    }

    onDropMarker(type, priceFromClientY(event.clientY));
  }

  function handleMarkerPointerDown(marker: TradeMarker, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      onUpdateMarkerPrice(marker.id, priceFromClientY(moveEvent.clientY));
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleMarkerKeyDown(marker: TradeMarker, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onRemoveMarker(marker.id);
  }

  return (
    <div
      className={`trading-chart${activeMarkerType || activeDrawingTool ? ' is-placing-marker' : ''}`}
      onClick={handleChartClick}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="trading-chart__surface" ref={surfaceRef} />
      {activeMarkerType || activeDrawingTool ? <div className="chart-placement-hint">{activeMarkerLabel ?? (activeDrawingTool === 'zone' ? 'Zone' : 'Line')} armed</div> : null}
      {positionPreview ? (
        <>
          <div
            className="trade-zone trade-zone--gain"
            style={
              {
                '--zone-height': `${zoneHeight(positionPreview.entry, positionPreview.takeProfit, priceRange)}%`,
                '--zone-top': `${zoneTop(positionPreview.entry, positionPreview.takeProfit, priceRange)}%`,
              } as CSSProperties
            }
          />
          <div
            className="trade-zone trade-zone--loss"
            style={
              {
                '--zone-height': `${zoneHeight(positionPreview.entry, positionPreview.stopLoss, priceRange)}%`,
                '--zone-top': `${zoneTop(positionPreview.entry, positionPreview.stopLoss, priceRange)}%`,
              } as CSSProperties
            }
          />
        </>
      ) : null}
      {drawings.map((drawing) =>
        drawing.type === 'zone' ? (
          <div
            className="chart-drawing-zone"
            key={drawing.id}
            style={
              {
                '--drawing-color': drawing.color,
                '--drawing-height': `${zoneHeight(drawing.upperPrice ?? drawing.price, drawing.lowerPrice ?? drawing.price, priceRange)}%`,
                '--drawing-top': `${zoneTop(drawing.upperPrice ?? drawing.price, drawing.lowerPrice ?? drawing.price, priceRange)}%`,
              } as CSSProperties
            }
          >
            <button
              aria-label={`Remove ${drawing.label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemoveDrawing(drawing.id);
              }}
              type="button"
            >
              {drawing.label}
              <X size={12} />
            </button>
          </div>
        ) : (
          <div
            className="chart-drawing-line"
            key={drawing.id}
            style={
              {
                '--drawing-color': drawing.color,
                '--drawing-top': `${priceToPercent(drawing.price, priceRange)}%`,
              } as CSSProperties
            }
          >
            <button
              aria-label={`Remove ${drawing.label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemoveDrawing(drawing.id);
              }}
              type="button"
            >
              {drawing.label}
              <X size={12} />
            </button>
          </div>
        ),
      )}
      {markers.map((marker) => (
        <div
          className="chart-marker-label"
          key={marker.id}
          role="group"
          style={
            {
              '--marker-color': marker.color,
              '--marker-top': `${priceToPercent(marker.price, priceRange)}%`,
            } as CSSProperties
          }
          title={`${marker.label} marker`}
        >
          <button
            aria-label={`Move ${marker.label} marker at ${formatUsd(marker.price)}`}
            className="chart-marker-label__drag"
            onKeyDown={(event) => handleMarkerKeyDown(marker, event)}
            onPointerDown={(event) => handleMarkerPointerDown(marker, event)}
            title={`Drag ${marker.label}`}
            type="button"
          >
            <span>{marker.label}</span>
            <strong>{formatUsd(marker.price)}</strong>
          </button>
          <button
            aria-label={`Remove ${marker.label} marker`}
            className="chart-marker-label__remove"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveMarker(marker.id);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            title={`Remove ${marker.label}`}
            type="button"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {positionPreview ? (
        <div
          className={`trade-ticket is-${positionPreview.direction}`}
          style={{ '--ticket-top': `${priceToPercent(positionPreview.entry, priceRange)}%` } as CSSProperties}
        >
          <span>{positionPreview.direction.toUpperCase()}</span>
          <strong>{positionPreview.riskReward.toFixed(2)}R</strong>
          <small>Entry {formatUsd(positionPreview.entry)}</small>
        </div>
      ) : null}
    </div>
  );
}

function resolvePriceRange(candles: Candle[], markers: TradeMarker[], drawings: ChartDrawing[]) {
  const candleHigh = Math.max(...candles.map((candle) => candle.high));
  const candleLow = Math.min(...candles.map((candle) => candle.low));
  const markerPrices = markers.map((marker) => marker.price);
  const drawingPrices = drawings.flatMap((drawing) => [drawing.price, drawing.upperPrice, drawing.lowerPrice].filter((price): price is number => typeof price === 'number'));
  const high = Math.max(candleHigh, ...markerPrices, ...drawingPrices);
  const low = Math.min(candleLow, ...markerPrices, ...drawingPrices);
  const padding = Math.max((high - low) * 0.12, 1);

  return {
    max: high + padding,
    min: low - padding,
  };
}

function priceToPercent(price: number, range: { max: number; min: number }) {
  return Math.min(92, Math.max(8, ((range.max - price) / (range.max - range.min)) * 100));
}

function zoneTop(firstPrice: number, secondPrice: number, range: { max: number; min: number }) {
  return Math.min(priceToPercent(firstPrice, range), priceToPercent(secondPrice, range));
}

function zoneHeight(firstPrice: number, secondPrice: number, range: { max: number; min: number }) {
  return Math.max(1, Math.abs(priceToPercent(firstPrice, range) - priceToPercent(secondPrice, range)));
}

function roundPrice(price: number) {
  return Number(price.toFixed(2));
}

function toCandlestickData(candles: Candle[]): CandlestickData<Time>[] {
  return candles.map<CandlestickData<Time>>((candle) => ({
    close: candle.close,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    time: candle.time as Time,
  }));
}

function toLineData(points: IndicatorPoint[]): LineData<Time>[] {
  return points.map<LineData<Time>>((point) => ({
    time: point.time as Time,
    value: Number(point.value.toFixed(6)),
  }));
}

function toHistogramData(points: IndicatorPoint[]): HistogramData<Time>[] {
  return points.map<HistogramData<Time>>((point) => ({
    color: point.value >= 0 ? 'rgba(98, 230, 168, 0.34)' : 'rgba(255, 95, 117, 0.34)',
    time: point.time as Time,
    value: Number(point.value.toFixed(6)),
  }));
}

function toVolumeData(candles: Candle[]): HistogramData<Time>[] {
  return candles.map<HistogramData<Time>>((candle) => ({
    color: candle.close >= candle.open ? 'rgba(98, 230, 168, 0.34)' : 'rgba(255, 95, 117, 0.34)',
    time: candle.time as Time,
    value: candle.volume,
  }));
}
