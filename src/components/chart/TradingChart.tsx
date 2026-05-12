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
import { formatUsd } from '../../utils/format';

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

export type ChartIndicatorConfig = {
  ema: {
    enabled: boolean;
    period: number;
  };
  maFast: {
    enabled: boolean;
    period: number;
  };
  maSlow: {
    enabled: boolean;
    period: number;
  };
  volume: {
    enabled: boolean;
  };
  vwap: {
    enabled: boolean;
  };
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maFastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maSlowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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

    const maFastSeries = chart.addSeries(LineSeries, {
      color: isLight ? 'rgba(3, 143, 196, 0.78)' : 'rgba(38, 200, 255, 0.82)',
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineWidth: 2,
      priceLineVisible: false,
    });

    const maSlowSeries = chart.addSeries(LineSeries, {
      color: isLight ? 'rgba(186, 122, 0, 0.82)' : 'rgba(255, 212, 90, 0.78)',
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineWidth: 2,
      priceLineVisible: false,
    });

    const emaSeries = chart.addSeries(LineSeries, {
      color: isLight ? 'rgba(145, 90, 255, 0.78)' : 'rgba(165, 108, 255, 0.82)',
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineWidth: 2,
      priceLineVisible: false,
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: isLight ? 'rgba(0, 154, 115, 0.74)' : 'rgba(98, 230, 168, 0.74)',
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineWidth: 2,
      priceLineVisible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      lastValueVisible: false,
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { bottom: 0, top: 0.78 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaSeriesRef.current = emaSeries;
    maFastSeriesRef.current = maFastSeries;
    maSlowSeriesRef.current = maSlowSeries;
    vwapSeriesRef.current = vwapSeries;
    volumeSeriesRef.current = volumeSeries;
    fittedDataIdentityRef.current = null;

    return () => {
      priceLineRefs.current = [];
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
      maFastSeriesRef.current = null;
      maSlowSeriesRef.current = null;
      vwapSeriesRef.current = null;
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
    maFastSeriesRef.current?.setData(indicators.maFast.enabled ? buildMovingAverageData(chartCandles, indicators.maFast.period) : []);
    maSlowSeriesRef.current?.setData(indicators.maSlow.enabled ? buildMovingAverageData(chartCandles, indicators.maSlow.period) : []);
    emaSeriesRef.current?.setData(indicators.ema.enabled ? buildExponentialAverageData(chartCandles, indicators.ema.period) : []);
    vwapSeriesRef.current?.setData(indicators.vwap.enabled ? buildVwapData(chartCandles) : []);
    volumeSeriesRef.current?.setData(indicators.volume.enabled ? toVolumeData(chartCandles) : []);

    if (fittedDataIdentityRef.current !== dataWindowIdentity) {
      fittedDataIdentityRef.current = dataWindowIdentity;
      chartRef.current?.timeScale().fitContent();
    }
  }, [chartCandles, dataWindowIdentity, indicators]);

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

function buildMovingAverageData(candles: Candle[], period: number): LineData<Time>[] {
  return candles.map<LineData<Time>>((candle, index) => {
    const start = Math.max(0, index - period + 1);
    const window = candles.slice(start, index + 1);
    const average = window.reduce((sum, item) => sum + item.close, 0) / window.length;

    return {
      time: candle.time as Time,
      value: Number(average.toFixed(4)),
    };
  });
}

function buildExponentialAverageData(candles: Candle[], period: number): LineData<Time>[] {
  if (!candles.length) {
    return [];
  }

  const safePeriod = Math.max(1, Math.round(period));
  const multiplier = 2 / (safePeriod + 1);
  let ema = candles[0].close;

  return candles.map<LineData<Time>>((candle, index) => {
    ema = index === 0 ? candle.close : candle.close * multiplier + ema * (1 - multiplier);

    return {
      time: candle.time as Time,
      value: ema,
    };
  });
}

function buildVwapData(candles: Candle[]): LineData<Time>[] {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return candles.map<LineData<Time>>((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    return {
      time: candle.time as Time,
      value: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : candle.close,
    };
  });
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

function toVolumeData(candles: Candle[]): HistogramData<Time>[] {
  return candles.map<HistogramData<Time>>((candle) => ({
    color: candle.close >= candle.open ? 'rgba(98, 230, 168, 0.34)' : 'rgba(255, 95, 117, 0.34)',
    time: candle.time as Time,
    value: candle.volume,
  }));
}
