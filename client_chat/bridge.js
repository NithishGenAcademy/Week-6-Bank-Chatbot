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

  function formatAccountDetails(customer, transactions) {
    if (!customer) {
      return "Account not found.";
    }

    const lines = [
      `Account Details for ${customer.name}`,
      `  User ID: ${customer.user_id}`,
      `  Tier: ${customer.tier}`,
      `  Balance: $${Number(customer.balance || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      `  Status: ${customer.status}`,
      `  Email: ${customer.email}`,
      `  Phone: ${customer.phone}`,
      `  Account Opened: ${customer.account_opened}`,
      `  KYC Status: ${customer.kyc_status}`,
    ];

    if (Array.isArray(customer.fraud_flags) && customer.fraud_flags.length) {
      lines.push(`  Fraud Flags: ${customer.fraud_flags.join(", ")}`);
    }

    if (transactions.length) {
      lines.push("\nRecent Transactions:");
      for (const txn of transactions) {
        const amount = txn.amount
          ? `$${Number(txn.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : "-";
        const desc = txn.description || "";
        const detail = txn.recipient ? `${txn.recipient} (${desc})` : desc;
        lines.push(
          `  [${txn.date}] ${txn.type} | ${amount} | ${detail} | ${txn.status}`
        );
      }
    }

    return lines.join("\n");
  }

  function executeToolCall(toolCall, toolData) {
    const name = toolCall?.function?.name || "";
    let args = {};
    try {
      args = JSON.parse(toolCall?.function?.arguments || "{}");
    } catch {
      args = {};
    }

    if (name === "lookup_policy") {
      const topic = String(args.topic || "").trim().toLowerCase();
      const knowledgeBase = toolData?.knowledge_base || {};
      if (knowledgeBase[topic]) {
        return String(knowledgeBase[topic]);
      }
      return `No policy found for topic: '${topic}'. Available topics are: ${Object.keys(
        knowledgeBase
      ).join(", ")}`;
    }

    if (name === "query_account") {
      const userId = String(args.user_id || "").trim();
      const customers = Array.isArray(toolData?.customers) ? toolData.customers : [];
      const transactions = Array.isArray(toolData?.transactions)
        ? toolData.transactions
        : [];
      const customer = customers.find((item) => item.user_id === userId);
      if (!customer) {
        return `Account not found for user_id: ${userId}`;
      }
      return formatAccountDetails(
        customer,
        transactions.filter((txn) => txn.user_id === userId)
      );
    }

    return `Unknown tool: ${name}`;
  }

  async function callOpenAI(apiKey, requestBody) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}`);
    }

    return data;
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

    const model = args.model || "gpt-3.5-turbo";
    const temperature = typeof args.temperature === "number" ? args.temperature : 0.3;
    const maxTokens = typeof args.max_tokens === "number" ? args.max_tokens : 2048;
    const tools = [
      {
        type: "function",
        function: {
          name: "lookup_policy",
          description: "Look up a specific NeoBank policy by topic name.",
          parameters: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description:
                  "One of: transfer_limits, dispute_process, card_management, fraud_detection, account_verification, internal_reference_only.",
              },
            },
            required: ["topic"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "query_account",
          description:
            "Look up account details and transactions for a user ID. Example user_id: USR-0042.",
          parameters: {
            type: "object",
            properties: {
              user_id: {
                type: "string",
                description: "NeoBank customer user ID.",
              },
            },
            required: ["user_id"],
          },
        },
      },
    ];

    const firstData = await callOpenAI(apiKey, {
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
      tools,
      tool_choice: "auto",
    });

    const assistantMessage = firstData?.choices?.[0]?.message;
    const toolCalls = assistantMessage?.tool_calls || [];
    if (!toolCalls.length) {
      return assistantMessage?.content || "";
    }

    const toolMessages = toolCalls.map((toolCall) => ({
      role: "tool",
      tool_call_id: toolCall.id,
      name: toolCall?.function?.name || "",
      content: executeToolCall(toolCall, args.tool_data || {}),
    }));

    const finalData = await callOpenAI(apiKey, {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...messages,
        {
          role: "assistant",
          content: assistantMessage.content || null,
          tool_calls: toolCalls,
        },
        ...toolMessages,
      ],
    });

    return finalData?.choices?.[0]?.message?.content || "";
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
