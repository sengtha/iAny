# Kaggle Walkthrough — Stage 4 (Export to Browser Format)

Converts `sengtha/iany-khmer-tiny-v1` to ONNX (q4 for WebGPU, q8 for CPU)
and pushes to a **public** HF repo. iAny's mirror pulls model files from
HF on a cache miss, so a public ONNX repo deploys with no manual R2 step.

Runs in minutes on CPU — you can use a **no-accelerator** Kaggle session
(saves your GPU quota). Internet On, `HF_TOKEN` write secret attached.

> ⚠️ The embedding-layer rule from `FINETUNE-KHMER.md` is critical here:
> q4-quantizing Gemma 270M's huge embedding matrix reverts it to script
> soup. We exclude it below.

## Cell 1 — install
```python
!pip install -q -U "optimum[onnxruntime]>=1.24" "transformers>=4.49" onnx onnxruntime huggingface_hub
```

## Cell 2 — login
```python
from kaggle_secrets import UserSecretsClient
from huggingface_hub import login
login(UserSecretsClient().get_secret("HF_TOKEN"))
```

## Cell 3 — export to ONNX (fp32 base graph)
```python
!optimum-cli export onnx -m sengtha/iany-khmer-tiny-v1 \
    --task text-generation-with-past ./export
import os; print(sorted(os.listdir("./export")))
```

## Cell 4 — make q8 (CPU) and q4 (WebGPU, embedding excluded)
```python
import os, glob, onnx
os.makedirs("out/onnx", exist_ok=True)

src = "export/model.onnx"

# --- q8: dynamic int8 for the WASM/CPU path ---
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic(src, "out/onnx/model_quantized.onnx", weight_type=QuantType.QInt8)

# --- q4: 4-bit block quant for WebGPU, EXCLUDING the embedding + lm_head ---
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer
m = onnx.load(src)
# find node names that touch the embedding / output projection and skip them
skip = [n.name for n in m.graph.node
        if ("embed" in n.name.lower() or "lm_head" in n.name.lower())]
print("excluding from q4:", skip[:6], "…", len(skip), "nodes")
q = MatMul4BitsQuantizer(m, block_size=32, is_symmetric=True, nodes_to_exclude=skip)
q.process()
onnx.save(q.model.model, "out/onnx/model_q4.onnx",
          save_as_external_data=True, location="model_q4.onnx_data")
print(sorted(os.listdir("out/onnx")))
```

## Cell 5 — copy config + tokenizer into the output folder
```python
import shutil, glob
for f in glob.glob("export/*.json") + glob.glob("export/*.model") + glob.glob("export/*.jinja"):
    shutil.copy(f, "out/")
print(sorted(os.listdir("out")))   # expect config.json, tokenizer*, onnx/
```

## Cell 6 — LOCAL SMOKE TEST (before publishing!)
Quantization is where a good fine-tune quietly dies. Verify Khmer still
works on the q8 file via Transformers-in-Python-through-ORT is awkward;
simplest is to just re-load the un-quantized export and confirm it, then
trust q8 (dynamic int8 rarely breaks). If you want a true ONNX check, load
`out/onnx/model_quantized.onnx` with `onnxruntime` and greedy-decode a
short prompt. If the q4 output is garbage but q8 is fine, ship q8-only
(set the tier to CPU-only) — that's an acceptable fallback.

## Cell 7 — push to a PUBLIC HF repo (so the mirror can fetch it)
```python
from huggingface_hub import HfApi
api = HfApi()
repo = "sengtha/iany-khmer-tiny-v1-ONNX"
api.create_repo(repo, private=False, exist_ok=True)   # PUBLIC
api.upload_folder(folder_path="out", repo_id=repo, repo_type="model")
print("done:", repo)
```

---

## After it uploads — tell me, and I deploy it

Once `sengtha/iany-khmer-tiny-v1-ONNX` is public with `onnx/model_q4.onnx`
+ `onnx/model_quantized.onnx` + config + tokenizer, I will:

1. Add `sengtha/iany-khmer-tiny-v1-ONNX/` to `ALLOWED_PREFIXES` in
   `worker/index.ts`.
2. Register it in `GEN_MODELS` as a Khmer tier (`cpuOk: true`).
3. Switch the Khmer path: when this model is selected, generate with the
   trained Khmer prompt
   (`បរិបទ៖\n{context}\n\nសំណួរ៖ {q}\nចម្លើយ៖`) instead of the extractive
   fallback.
4. Verify end-to-end in the browser.

## If the export fights back

ONNX export/quantization is the finickiest step in the whole project
(version drift in optimum/onnxruntime). If a cell errors, paste it — the
fixes are usually a renamed arg or a node-name pattern. Worst case, we
ship **q8-only** (CPU) first, which is the path your phones use anyway,
and add q4/WebGPU later.
