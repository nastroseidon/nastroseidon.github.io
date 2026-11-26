# Text recognizer for the web edition

Used by `src/browser-ocr.mjs` to read item photos on the device (iPhone / browser). Unmodified copies of:

- `tesseract.min.js`, `worker.min.js`: tesseract.js 5.1.1 (Apache-2.0), https://github.com/naptha/tesseract.js
- `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`: tesseract.js-core 5.1.1 (Apache-2.0)
- `eng.traineddata.gz`: English LSTM model `4.0.0_best_int` from @tesseract.js-data/eng 1.0.0 (Tesseract tessdata, Apache-2.0)
