# Khmer OCR recognizer: train on synthetic data → ship to the app

Goal: replace the app's recognizer (`rec.onnx`) with a **better Khmer OCR
recognizer** trained on a large, scene-realistic dataset — so it stops inventing
"unknown numbers" on real photos. Keep the existing **detector** (`det.onnx`);
only the recognizer changes.

- **Base data:** [`Sokheng/khmer-synthetic-ocr-v1-100k`](https://huggingface.co/datasets/Sokheng/khmer-synthetic-ocr-v1-100k)
  — 100k `(image, text)` line crops, Khmer + English + digits/`$`, receipts /
  menus / price-tags / signage, **CC-BY-4.0**.
- **Later:** fine-tune on your **`/scan`** real photos (`docs/OCR-COLLECTION.md`)
  for real-world robustness. Synthetic gets you far; real photos close the gap.
- **License:** CC-BY-4.0 combines into a **CC-BY-SA-4.0** release; credit Sokheng.

> This is a bigger lift than the STT fine-tune (we train a small model from
> scratch, not fine-tune a pretrained one), but the architecture is standard and
> ~100k samples is plenty. whisper-tiny-style budget: a few hours on one GPU.

---

## 1. Pod + deps
RunPod PyTorch 2.x, any mid GPU (RTX A4000/4090), Volume at `/workspace`.

```bash
pip install -U torch torchvision datasets pillow numpy onnx onnxruntime huggingface_hub tqdm
```

## 2. The recognizer — a CRNN + CTC (on-device friendly)

CRNN = CNN (image → feature columns) + BiLSTM (sequence) + CTC head. It matches
the app's pipeline exactly: **grayscale, height 32, variable width**, CTC output.

```python
# model.py
import torch, torch.nn as nn

class CRNN(nn.Module):
    def __init__(self, n_classes, n_hidden=256):
        super().__init__()
        def block(i, o, k=3, s=1, p=1): return nn.Sequential(
            nn.Conv2d(i, o, k, s, p), nn.BatchNorm2d(o), nn.ReLU(inplace=True))
        self.cnn = nn.Sequential(
            block(1, 64),   nn.MaxPool2d(2, 2),           # 32 -> 16
            block(64, 128), nn.MaxPool2d(2, 2),           # 16 -> 8
            block(128, 256), block(256, 256), nn.MaxPool2d((2, 1), (2, 1)),  # 8 -> 4, width kept
            block(256, 512), block(512, 512), nn.MaxPool2d((2, 1), (2, 1)),  # 4 -> 2
            block(512, 512, k=2, s=1, p=0),               # 2 -> 1 (height collapses)
        )
        self.rnn = nn.LSTM(512, n_hidden, num_layers=2, bidirectional=True, batch_first=False)
        self.fc = nn.Linear(n_hidden * 2, n_classes)

    def forward(self, x):                 # x: [B,1,32,W]
        f = self.cnn(x)                    # [B,512,1,W']
        f = f.squeeze(2).permute(2, 0, 1)  # [W', B, 512]
        f, _ = self.rnn(f)
        return self.fc(f)                  # [W', B, n_classes]  (CTC: blank = 0)
```

## 3. Data → charset + loaders

Build the **charset from the data** (auto-covers Khmer + English + digits + `$`),
preprocess each image exactly like the app (`buildRecInput`): grayscale, resize
to **height 32** keeping aspect, values `/255`.

```python
# data.py
import numpy as np, torch
from PIL import Image
from datasets import load_dataset

REPO = "Sokheng/khmer-synthetic-ocr-v1-100k"
H = 32

def build_charset(ds, text_col="text"):
    chars = set()
    for t in ds[text_col]:
        chars.update(t)
    charset = "".join(sorted(chars))          # index i -> charset[i]; CTC blank = 0
    return charset  # save this — the app must use the SAME string + order

def to_input(pil):                            # -> Float32 [1, 32, W]
    g = pil.convert("L")
    w = max(1, round(g.width * H / g.height))
    g = g.resize((w, H), Image.BILINEAR)
    return (np.asarray(g, np.float32) / 255.0)[None]   # [1,H,W]

class OcrDS(torch.utils.data.Dataset):
    def __init__(self, hfds, charset, img_col="image", text_col="text"):
        self.ds = hfds; self.text_col = text_col; self.img_col = img_col
        self.stoi = {c: i + 1 for i, c in enumerate(charset)}   # 0 = CTC blank
    def __len__(self): return len(self.ds)
    def __getitem__(self, i):
        ex = self.ds[i]
        x = to_input(ex[self.img_col] if isinstance(ex[self.img_col], Image.Image)
                     else Image.open(ex[self.img_col]["path"]))
        y = [self.stoi[c] for c in ex[self.text_col] if c in self.stoi]
        return torch.from_numpy(x), torch.tensor(y, dtype=torch.long)

def collate(batch):                           # pad widths to the batch max
    xs, ys = zip(*batch)
    W = max(x.shape[2] for x in xs)
    xb = torch.zeros(len(xs), 1, H, W)
    for i, x in enumerate(xs): xb[i, :, :, : x.shape[2]] = x
    y_cat = torch.cat(ys); y_len = torch.tensor([len(y) for y in ys])
    return xb, y_cat, y_len
```

## 4. Train (CTC)

```python
# train.py  (nohup it, like the STT run)
import torch, torch.nn as nn
from torch.utils.data import DataLoader, random_split
from datasets import load_dataset
from model import CRNN
from data import OcrDS, collate, build_charset

raw = load_dataset("Sokheng/khmer-synthetic-ocr-v1-100k", split="train")
charset = build_charset(raw)
open("/workspace/charset.txt", "w", encoding="utf-8").write(charset)
print("charset:", len(charset), "classes:", len(charset) + 1)

ds = OcrDS(raw, charset)
n_val = 2000; tr, va = random_split(ds, [len(ds) - n_val, n_val],
                                    generator=torch.Generator().manual_seed(42))
dl = DataLoader(tr, batch_size=64, shuffle=True, collate_fn=collate, num_workers=4)

dev = "cuda"
model = CRNN(len(charset) + 1).to(dev)
opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
ctc = nn.CTCLoss(blank=0, zero_infinity=True)

for epoch in range(8):
    model.train()
    for xb, y, yl in dl:
        xb = xb.to(dev)
        logits = model(xb)                     # [W', B, C]
        logp = logits.log_softmax(2)
        in_len = torch.full((xb.size(0),), logp.size(0), dtype=torch.long)
        loss = ctc(logp, y.to(dev), in_len, yl)
        opt.zero_grad(); loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
    print(f"epoch {epoch}  loss {loss.item():.3f}", flush=True)
    torch.save(model.state_dict(), "/workspace/crnn.pt")
```

Watch the loss fall; a quick greedy-CTC accuracy check on `va` tells you when it's
good (aim for high exact-line match on this clean synthetic set). ~8 epochs over
100k is a few hours.

## 5. Export ONNX (matches the app's `rec.onnx` interface)

```python
import torch
from model import CRNN
charset = open("/workspace/charset.txt", encoding="utf-8").read()
model = CRNN(len(charset) + 1); model.load_state_dict(torch.load("/workspace/crnn.pt")); model.eval()
dummy = torch.randn(1, 1, 32, 256)
torch.onnx.export(model, dummy, "/workspace/rec.onnx",
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {3: "width"}, "logits": {0: "seq"}}, opset_version=17)
print("exported rec.onnx — classes:", len(charset) + 1)
```

This gives `input [1,1,32,W] → logits [W',1,C]`, exactly what
`packages/core/src/khmerocr.ts` expects.

## 6. Wire it into the app (coordinated with the upload)

The new recognizer has a **new charset**, so update the shared OCR module to match
(these changes ship *together with* the new `rec.onnx` — until then the current
OCR keeps working):

- `packages/core/src/khmerocr.ts`:
  - `OCR_TOKENS` = the exact `charset.txt` string (same order).
  - `REC_NUM_CLASSES` = `len(charset) + 1`.
  - In `ctcDecode`, map class `i` → `OCR_TOKENS[i - 1]` (this model uses **blank = 0,
    classes 1..N = charset** — no 3-token offset). Change the `idx >= 3 … idx - 3`
    line to `idx >= 1 … idx - 1`.
- Upload the new `rec.onnx` to **`sengtha/khmer-ocr`** (keep `det.onnx`). Bump a
  cache-bust if the app caches by filename.

Tell me when `crnn.pt` trains and you've got `charset.txt` — I'll make the exact
`khmerocr.ts` edits (they must match your trained charset byte-for-byte) and bump
the model version.

## 7. Later: fine-tune on real `/scan` photos

Once you've collected `/scan` samples (`scripts/export-ocr.mjs` → `labels.jsonl`),
continue-train `crnn.pt` on them (oversampled, like `/voice` for STT). Real
photos are where synthetic-trained OCR breaks, so this is the step that makes it
genuinely good on phone cameras.

## Credits & license
Release the model **CC-BY-SA-4.0**, crediting **Sokheng/khmer-synthetic-ocr-v1-100k**
(CC-BY-4.0), seanghay/KhmerOCR (detector, MIT), and your `/scan` contributors.
