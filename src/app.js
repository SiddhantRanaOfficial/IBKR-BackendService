import "dotenv/config"
import express from "express"
import { historicalData } from "./sampleData.js";

const app = express()

app.use(express.json())

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Broker data API is running"
  })
})

app.get("/api/market-data/history", (req, res) => {
  const { symbol } = req.query;

  if (typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({
      success: false,
      message: "Provide a stock symbol, for example ?symbol=AAPL",
    });
  }

  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!Object.hasOwn(historicalData, normalizedSymbol)) {
    return res.status(404).json({
      success: false,
      message: `No sample historical data available for ${normalizedSymbol}`,
    });
  }

  return res.status(200).json({
    success: true,
    source: "mock",
    symbol: normalizedSymbol,
    currency: "USD",
    interval: "1d",
    bars: historicalData[normalizedSymbol],
  });
});

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`)
})