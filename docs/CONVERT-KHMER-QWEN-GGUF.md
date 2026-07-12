# Convert the trimmed Khmer Qwen3 to GGUF

`alphaedge-ai/Qwen3-0.6B-khm-32768` is a Qwen3 0.6B trimmed to a 32,768-token
Khmer vocabulary — ideal for the S10 (small vocab loads fast, Khmer-trained,
Qwen3 so no Gemma-3 llama.rn bug). But HF's gguf-my-repo Space fails on it:

```
NotImplementedError: BPE pre-tokenizer was not recognized - update get_vocab_base_pre()
```

Trimming produced a custom tokenizer whose fingerprint llama.cpp doesn't know.
Since it's still a Qwen3, the pre-tokenizer IS Qwen's — we just force it. Run
this in **Colab or Kaggle** (a GPU isn't needed; CPU is fine for 0.6B).

```python
# 1. llama.cpp + deps
!git clone --depth 1 https://github.com/ggml-org/llama.cpp
!pip install -q -r llama.cpp/requirements.txt huggingface_hub

# 2. Patch: force the Qwen pre-tokenizer for the unrecognized trimmed tokenizer
#    (correct — it is a Qwen3 model). Robust across llama.cpp file layouts.
import pathlib
needle = 'raise NotImplementedError("BPE pre-tokenizer was not recognized - update get_vocab_base_pre()")'
for p in pathlib.Path("llama.cpp").rglob("*.py"):
    s = p.read_text()
    if needle in s:
        p.write_text(s.replace(needle, 'return "qwen2"  # forced: trimmed Qwen3'))
        print("patched", p)

# 3. Download the model
from huggingface_hub import snapshot_download
snapshot_download("alphaedge-ai/Qwen3-0.6B-khm-32768", local_dir="khm")

# 4. Convert to f16 GGUF
!python llama.cpp/convert_hf_to_gguf.py khm --outfile khm-f16.gguf --outtype f16

# 5. Build llama-quantize and make a Q8_0 (smaller, still high quality)
!cd llama.cpp && cmake -B build -DLLAMA_CURL=OFF >/dev/null && \
   cmake --build build --config Release -j --target llama-quantize >/dev/null
!./llama.cpp/build/bin/llama-quantize khm-f16.gguf Qwen3-0.6B-khm-32768-Q8_0.gguf Q8_0

# 6. Upload to your HF account. Use ONE authenticated client for both
#    create_repo AND upload_file (a fresh HfApi() has no token -> 401).
#    The token must be a WRITE token (huggingface.co/settings/tokens).
from huggingface_hub import HfApi
from getpass import getpass
api = HfApi(token=getpass("HF WRITE token: "))
api.create_repo("sengtha/Qwen3-0.6B-khm-32768-Q8_0-GGUF", exist_ok=True)
api.upload_file(
    path_or_fileobj="Qwen3-0.6B-khm-32768-Q8_0.gguf",
    path_in_repo="Qwen3-0.6B-khm-32768-Q8_0.gguf",
    repo_id="sengtha/Qwen3-0.6B-khm-32768-Q8_0-GGUF",
)
print("done -> sengtha/Qwen3-0.6B-khm-32768-Q8_0-GGUF")
```

Then send the repo name (`sengtha/Qwen3-0.6B-khm-32768-Q8_0-GGUF`) and iAny is
pointed at it for the S10.

## If `convert` still complains about `vocab_size`

Trimmed models can also have `config.json` `vocab_size` out of sync with the
tokenizer/embedding. Open `khm/config.json`, set `vocab_size` to the embedding
row count (check `model.embed_tokens.weight` shape, likely `32768`), and re-run
step 4.
