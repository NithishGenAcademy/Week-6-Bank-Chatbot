(() => {
  const API_KEY_STORAGE_KEY = "neobank-aria:openai-api-key";
  const RESPONSE_STORAGE_PREFIX = "neobank-aria:response:";
  const state = {
    pendingRequests: new Map(),
  };

  function postMessage(type, data = {}) {
    window.parent.postMessage(
      {
        isStreamlitMessage: true,
        type,
        ...data,
      },
      "*"
    );
  }

  function setComponentValue(value) {
    postMessage("streamlit:setComponentValue", { value });
  }

  function setFrameHeight(height = 1) {
    postMessage("streamlit:setFrameHeight", {
      height: Math.max(Math.ceil(height), 1),
    });
  }

  function setReady() {
    postMessage("streamlit:componentReady", { apiVersion: 1 });
  }

  function readStoredValue() {
    try {
      return (
        window.parent.localStorage.getItem(API_KEY_STORAGE_KEY) ||
        window.localStorage.getItem(API_KEY_STORAGE_KEY) ||
        ""
      );
    } catch {
      try {
        return window.localStorage.getItem(API_KEY_STORAGE_KEY) || "";
      } catch {
        return "";
      }
    }
  }

  function looksLikeApiKey(value) {
    return value.startsWith("sk-") && value.length >= 40;
  }

  function readCachedResponse(requestId) {
    try {
      const raw = window.localStorage.getItem(`${RESPONSE_STORAGE_PREFIX}${requestId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function cacheResponse(requestId, payload) {
    try {
      window.localStorage.setItem(
        `${RESPONSE_STORAGE_PREFIX}${requestId}`,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore cache failures.
    }
  }

  async function fetchAssistantResponse(args, requestId) {
    const apiKey = readStoredValue();
    if (!looksLikeApiKey(apiKey)) {
      throw new Error("Please enter your OpenAI API key in the sidebar to start chatting.");
    }

    const messages = [];
    if (typeof args.system_prompt === "string" && args.system_prompt) {
      messages.push({ role: "system", content: args.system_prompt });
    }

    if (Array.isArray(args.chat_history)) {
      for (const message of args.chat_history) {
        if (
          message &&
          typeof message.role === "string" &&
          typeof message.content === "string"
        ) {
          messages.push({ role: message.role, content: message.content });
        }
      }
    }

    if (typeof args.user_message === "string" && args.user_message) {
      messages.push({ role: "user", content: args.user_message });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: args.model || "gpt-3.5-turbo",
        temperature: typeof args.temperature === "number" ? args.temperature : 0.3,
        max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : 2048,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}`);
    }

    return data?.choices?.[0]?.message?.content || "";
  }

  function startChatRequest(args) {
    const requestId = String(args.request_id || "");
    if (!requestId) {
      return;
    }

    const cached = readCachedResponse(requestId);
    if (cached) {
      setComponentValue({
        ...cached,
        status: cached.error ? "error" : "complete",
      });
      return;
    }

    if (state.pendingRequests.has(requestId)) {
      return;
    }

    setComponentValue({
      request_id: requestId,
      status: "started",
      response: "",
      error: null,
    });

    const pending = fetchAssistantResponse(args, requestId)
      .then((responseText) => {
        const payload = {
          request_id: requestId,
          status: "complete",
          response: responseText,
          error: null,
        };
        cacheResponse(requestId, payload);
        setComponentValue(payload);
      })
      .catch((error) => {
        const payload = {
          request_id: requestId,
          status: "error",
          response: "",
          error: error instanceof Error ? error.message : String(error),
        };
        cacheResponse(requestId, payload);
        setComponentValue(payload);
      })
      .finally(() => {
        state.pendingRequests.delete(requestId);
      });

    state.pendingRequests.set(requestId, pending);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "streamlit:render") {
      return;
    }

    if (data.args?.mode === "chat") {
      setComponentValue({
        request_id: String(data.args.request_id || ""),
        status: "rendered",
        response: "",
        error: null,
      });
      startChatRequest(data.args);
    }
    setFrameHeight();
  });

  function boot() {
    setFrameHeight();
    setTimeout(() => setReady(), 0);
  }

  if (document.readyState === "loading") {
    window.addEventListener("load", boot, { once: true });
  } else {
    boot();
  }
})();
