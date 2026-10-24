---
title: Local models
description: Run a model you host yourself (llama.cpp, vLLM, Ollama, LM Studio) in an AgentOS chat through Pi or OpenCode, with tool calling turned on.
order: 9
---

# Local models

A model you host yourself (Qwen, Llama, Mistral, through llama.cpp, vLLM, Ollama or LM Studio) runs in an AgentOS chat through **Pi** or **OpenCode**, not through Settings > Models. Those providers only feed Claude Code and need an Anthropic-compatible endpoint. Add the model to the agent's own config and pick it in the new-chat model list.

## Pi

Add the server to Pi's `models.json` (`~/.pi/agent/models.json`):

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen3-27b",
          "name": "Qwen 27B",
          "contextWindow": 131072,
          "maxTokens": 16384
        }
      ]
    }
  }
}
```

Set `maxTokens` to what the model can write in one reply. A low value cuts replies off mid-sentence (the chat shows "finish reason: length").

## Turn on tool calling in the server

An agent needs the model to answer with a structured `tool_calls` field. A server that isn't set up for it returns the call as plain text, and the model "says" it will run something but nothing runs.

- **llama.cpp**: start `llama-server` with `--jinja` (and a chat template that supports tools).
- **vLLM**: `--enable-auto-tool-choice --tool-call-parser hermes`, or `--tool-call-parser qwen3_coder` for Qwen3-Coder.
- **Ollama**: use a model whose template lists tool support.
- **LM Studio**: load a model marked for tool use.

## What AgentOS does when it still comes back as text

With Pi, AgentOS reads a reply that ends in `<tool_call>` blocks (the JSON form Hermes and Qwen write, or Qwen3-Coder's `<function=…>` form) and runs them as real tool calls. Only blocks at the very end of a reply count, outside code fences, naming a tool the chat has. They go through the same approvals as any other call: in Ask or Accept edits mode you are asked first. OpenCode has no such hook; fix the server instead.

## When a turn ends without finishing

The line under a turn reads **Ended early** (not **Done**) when it stopped short, with a notice saying why:

- the model said it would act but called no tool;
- it hit its output limit (`finish reason: length`);
- it wrote a tool call AgentOS couldn't run;
- it sent an empty reply, or the server returned an error.

### When the model's server stops answering

A request that times out (OpenCode's "Provider response headers timed out") or is dropped (connection reset, 429, 5xx) is tried again, up to three times, waiting 2, 4 and 8 seconds. The tool steps that already ran stay in the conversation, and the retry tells the model to carry on, not redo them. If the context is large, it is compacted before the last try. Where OpenCode or Pi already retried the failure themselves, AgentOS adds no retries on top. Stopping the turn cancels a retry that is waiting.

When the tries run out the turn ends early with a notice of what finished (tool steps, files edited, which edits failed) and what didn't. Send "continue" and it picks up from there.

With OpenCode, AgentOS also raises the wait for a model server's first response from 5 to 20 minutes for the providers in your OpenCode config and the one you picked, since a local model reading a long prompt sends nothing until it has finished. The 5 minute limit on silence once a reply is streaming stays. A `headerTimeout` you set yourself in `opencode.json` is kept.

### Edits that miss, and broken syntax

AgentOS puts a guard beside the edit tools of OpenCode and Pi. An edit whose old text isn't in the file is refused before it runs, and the model is shown the file's current lines around the closest match and told to read the file again; sending the same failing edit again says so. Anything the agent's own matching would accept is let through. After an edit or write to a `.ts`, `.tsx`, `.js` or similar file, a syntax-only parse adds any new syntax errors and names declared twice in one block to the tool result, so the model fixes them at once. Errors the file already had are not repeated. The parse uses the project's own `typescript` package, or AgentOS's; with neither, it says nothing.

A task whose turn ends this way is not treated as finished work: the orchestrator is told it ended early and why. Each case also writes one line to the chat worker's log (`[chat] turn ended early {…}`) with the driver, provider, model, finish reason and the last 240 characters of the reply with secrets masked. Never the prompt. The log sits next to the worker's socket in `~/.agent-os/chat/`.

## Ollama models in the new-session menu

AgentOS asks Ollama on each machine (`OLLAMA_HOST`, else `127.0.0.1:11434`) which models it serves and lists them under "Ollama" in the Agent menu of a new session, for the machine you picked. Picking one switches the session to OpenCode (or Pi) with that model. A model shows greyed out when neither agent lists it, which usually means OpenCode's config has no Ollama provider yet.
