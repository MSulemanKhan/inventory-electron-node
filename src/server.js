const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

// Sample API
app.get("/api/ping", (req, res) => {
  res.send({ status: "Backend running" });
});

app.listen(3000, () => console.log("Backend running on port 3000"));
