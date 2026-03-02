(function () {
  const TOKEN_KEY = "ops_platform_access_token";

  const tokenInput = document.getElementById("token-input");
  const authOutput = document.getElementById("auth-output");
  const assetsOutput = document.getElementById("assets-output");
  const awsOutput = document.getElementById("aws-output");

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    tokenInput.value = token;
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    tokenInput.value = "";
  }

  function pretty(data) {
    return JSON.stringify(data, null, 2);
  }

  function write(el, data, ok) {
    el.textContent = typeof data === "string" ? data : pretty(data);
    el.classList.remove("ok", "error");
    el.classList.add(ok ? "ok" : "error");
  }

  async function api(path, options) {
    const token = getToken();
    const headers = Object.assign(
      {
        "Content-Type": "application/json",
      },
      options && options.headers ? options.headers : {}
    );

    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    const response = await fetch(path, {
      method: "GET",
      ...options,
      headers,
    });

    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      payload = text;
    }

    if (!response.ok) {
      throw new Error(pretty(payload));
    }
    return payload;
  }

  async function loadMe() {
    try {
      const data = await api("/auth/me");
      write(authOutput, data, true);
    } catch (error) {
      write(authOutput, error.message, false);
    }
  }

  async function listAssets() {
    try {
      const data = await api("/api/v1/cmdb/assets");
      write(assetsOutput, data, true);
    } catch (error) {
      write(assetsOutput, error.message, false);
    }
  }

  async function listAwsAccounts() {
    try {
      const data = await api("/api/v1/aws/accounts");
      write(awsOutput, data, true);
    } catch (error) {
      write(awsOutput, error.message, false);
    }
  }

  function parseRegions(csv) {
    if (!csv || !csv.trim()) {
      return [];
    }
    return csv
      .split(",")
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);
  }

  document.getElementById("save-token-btn").addEventListener("click", function () {
    const value = tokenInput.value.trim();
    if (!value) {
      write(authOutput, "Token is empty", false);
      return;
    }
    setToken(value);
    write(authOutput, { message: "Token saved" }, true);
  });

  document.getElementById("clear-token-btn").addEventListener("click", function () {
    clearToken();
    write(authOutput, { message: "Token cleared" }, true);
  });

  document.getElementById("oidc-login-btn").addEventListener("click", function () {
    window.location.href = "/auth/oidc/login";
  });

  document.getElementById("check-me-btn").addEventListener("click", loadMe);

  document.getElementById("refresh-assets-btn").addEventListener("click", listAssets);
  document.getElementById("refresh-aws-btn").addEventListener("click", listAwsAccounts);

  document.getElementById("asset-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const form = new FormData(event.target);
    const body = {
      type: String(form.get("type") || "").trim(),
      name: String(form.get("name") || "").trim(),
      env: String(form.get("env") || "").trim() || "default",
      source: String(form.get("source") || "").trim() || "manual",
    };

    try {
      const created = await api("/api/v1/cmdb/assets", {
        method: "POST",
        body: JSON.stringify(body),
      });
      write(assetsOutput, { created: created }, true);
      await listAssets();
      event.target.reset();
    } catch (error) {
      write(assetsOutput, error.message, false);
    }
  });

  document.getElementById("aws-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const form = new FormData(event.target);
    const authMode = String(form.get("auth_mode") || "assume_role");
    const body = {
      account_id: String(form.get("account_id") || "").trim(),
      display_name: String(form.get("display_name") || "").trim(),
      auth_mode: authMode,
      role_arn: String(form.get("role_arn") || "").trim(),
      access_key_id: String(form.get("access_key_id") || "").trim(),
      secret_access_key: String(form.get("secret_access_key") || "").trim(),
      region_allowlist: parseRegions(String(form.get("region_allowlist") || "")),
      enabled: true,
    };

    try {
      const created = await api("/api/v1/aws/accounts", {
        method: "POST",
        body: JSON.stringify(body),
      });
      write(awsOutput, { created: created }, true);
      await listAwsAccounts();
      event.target.reset();
    } catch (error) {
      write(awsOutput, error.message, false);
    }
  });

  tokenInput.value = getToken();
  write(authOutput, { message: "Load token, then validate /auth/me and API actions." }, true);
})();

