export const jimmyPineSource = `//@version=5
strategy("Combined TRIX & Donchian Strategy - ATR & Drawdown/Drawup Entry", overlay=true, default_qty_type=strategy.fixed, default_qty_value=100, initial_capital=300, currency="USDT", pyramiding=5, commission_type=strategy.commission.percent, commission_value=0.07)

enableLong  = input.bool(true, title="Activer les positions Long")
enableShort = input.bool(true, title="Activer les positions Short")

long_ma_length       = input.int(200, title="Long MA Length")
long_ma_type         = input.string("SMA", title="Long MA Type", options=["SMA", "EMA"])
trix_length          = input.int(8, title="TRIX Length")
trix_signal_length   = input.int(15, title="TRIX Signal Length")
fastMA_length        = input.int(20, title="Fast MA Length", minval=1, group="Moyennes Mobiles")
slowMA_length        = input.int(50, title="Slow MA Length", minval=1, group="Moyennes Mobiles")
ma_type              = input.string("EMA", title="MA Type", options=["SMA", "EMA"], group="Moyennes Mobiles")
donchianLength       = input.int(20, title="Donchian Channel Length", group="Paramètres Donchian")
rsi_length           = input.int(14, title="RSI Length", group="RSI Settings")
rsi_overbought       = input.int(70, title="RSI Overbought Level", group="RSI Settings")
rsi_oversold         = input.int(30, title="RSI Oversold Level", group="RSI Settings")
atr_length           = input.int(14, title="ATR Length", group="Gestion du Risque")
atr_multiplierSL     = input.float(1.5, title="ATR Stop Loss Multiplier", group="Gestion du Risque")
atr_multiplierTrail  = input.float(2.0, title="ATR Trailing Stop Multiplier", group="Gestion du Risque")
atr_val              = ta.atr(atr_length)

enableDrawdownEntry   = input.bool(true, title="Activer l'entrée sur fin de drawdown (Long)", group="Drawdown/Drawup Entry")
drawdownLookback      = input.int(50, title="Période de calcul du drawdown (Long)", group="Drawdown/Drawup Entry")
drawdownThreshold     = input.float(10.0, title="Seuil de drawdown élevé (%) (Long)", group="Drawdown/Drawup Entry")
drawdownRecoveryLevel = input.float(5.0, title="Niveau de récupération du drawdown (%) (Long)", group="Drawdown/Drawup Entry")

enableDrawupEntry     = input.bool(true, title="Activer l'entrée sur fin de drawup (Short)", group="Drawdown/Drawup Entry")
drawupLookback        = input.int(50, title="Période de calcul du drawup (Short)", group="Drawdown/Drawup Entry")
drawupThreshold       = input.float(10.0, title="Seuil de drawup élevé (%) (Short)", group="Drawdown/Drawup Entry")
drawupRecoveryLevel   = input.float(5.0, title="Niveau de récupération du drawup (%) (Short)", group="Drawdown/Drawup Entry")

highestClose       = ta.highest(close, drawdownLookback)
currentDrawdownPct = (highestClose - close) / highestClose * 100
var bool inDrawdownEvent = false
if currentDrawdownPct >= drawdownThreshold
    inDrawdownEvent := true
bool drawdownRecoveryCondition = inDrawdownEvent and (currentDrawdownPct <= drawdownRecoveryLevel)
if drawdownRecoveryCondition
    inDrawdownEvent := false

lowestClose      = ta.lowest(close, drawupLookback)
currentDrawupPct = (close - lowestClose) / lowestClose * 100
var bool inDrawupEvent = false
if currentDrawupPct >= drawupThreshold
    inDrawupEvent := true
bool drawupRecoveryCondition = inDrawupEvent and (currentDrawupPct <= drawupRecoveryLevel)
if drawupRecoveryCondition
    inDrawupEvent := false

long_ma = long_ma_type == "SMA" ? ta.sma(close, long_ma_length) : ta.ema(close, long_ma_length)
trix_ema1 = ta.ema(close, trix_length)
trix_ema2 = ta.ema(trix_ema1, trix_length)
trix_ema3 = ta.ema(trix_ema2, trix_length)
trix = (trix_ema3 - trix_ema3[1]) / trix_ema3[1] * 100
trix_signal = ta.sma(trix, trix_signal_length)
fastMA = ma_type == "SMA" ? ta.sma(close, fastMA_length) : ta.ema(close, fastMA_length)
slowMA = ma_type == "SMA" ? ta.sma(close, slowMA_length) : ta.ema(close, slowMA_length)
donchianUpper = ta.highest(high, donchianLength)
donchianLower = ta.lowest(low, donchianLength)
rsi = ta.rsi(close, rsi_length)

bullishTrend = fastMA > slowMA
bearishTrend = fastMA < slowMA
trix_long_condition  = ta.crossover(trix, trix_signal) and close > long_ma
trix_short_condition = ta.crossunder(trix, trix_signal) and close < long_ma
donchian_long_condition  = bullishTrend and close > donchianUpper[1]
donchian_short_condition = bearishTrend and close < donchianLower[1]
rsi_long_condition  = rsi < rsi_oversold
rsi_short_condition = rsi > rsi_overbought
longCondition  = (trix_long_condition or donchian_long_condition or rsi_long_condition) and bullishTrend
shortCondition = (trix_short_condition or donchian_short_condition or rsi_short_condition) and bearishTrend

drawdownRecoveryEntry = enableDrawdownEntry and drawdownRecoveryCondition and enableLong
drawupRecoveryEntry   = enableDrawupEntry and drawupRecoveryCondition and enableShort

if (longCondition or drawdownRecoveryEntry) and enableLong
    strategy.entry("Long", strategy.long)

if (shortCondition or drawupRecoveryEntry) and enableShort
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    longStopLoss = strategy.position_avg_price - atr_multiplierSL * atr_val
    longTrail    = atr_multiplierTrail * atr_val
    strategy.exit("Exit Long", from_entry="Long", stop=longStopLoss, trail_offset=longTrail)

if strategy.position_size < 0
    shortStopLoss = strategy.position_avg_price + atr_multiplierSL * atr_val
    shortTrail    = atr_multiplierTrail * atr_val
    strategy.exit("Exit Short", from_entry="Short", stop=shortStopLoss, trail_offset=shortTrail)

if strategy.position_size > 0 and close < long_ma
    strategy.close("Long", comment="Exit MA Cross")
if strategy.position_size < 0 and close > long_ma
    strategy.close("Short", comment="Exit MA Cross")

plot(fastMA, title="Fast MA", color=color.blue, linewidth=2)
plot(slowMA, title="Slow MA", color=color.red, linewidth=2)
plot(long_ma, title="Long MA", color=color.purple, linewidth=2)
plot(trix, title="TRIX", color=color.green)
plot(trix_signal, title="TRIX Signal", color=color.red)
plot(donchianUpper, title="Donchian Upper", color=color.purple)
plot(donchianLower, title="Donchian Lower", color=color.purple)
plot(rsi, title="RSI", color=color.orange)
plotshape(drawdownRecoveryCondition, title="Drawdown Recovery Entry", location=location.belowbar, color=color.green, style=shape.labelup, text="DD Entry")
plotshape(drawupRecoveryCondition, title="Drawup Recovery Entry", location=location.abovebar, color=color.red, style=shape.labeldown, text="DU Entry")`;

export const coreTrixDonchianPine = jimmyPineSource;
