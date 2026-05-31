import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VChart } from "@visactor/react-vchart";
import {
  Activity,
  BarChart3,
  Boxes,
  CircleDollarSign,
  Database,
  Download,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  LayoutDashboard,
  List,
  LockKeyhole,
  LogIn,
  LogOut,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Tag,
  Timer,
  Trash2,
  Type,
  Upload,
  UserRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEYS = {
  models: "cliproxy-console.models",
  auth: "cliproxy-console.auth",
  session: "cliproxy-console.session",
};

const chartOption = {
  mode: "desktop-browser",
};

const demoModels = [
  { id: "gpt-5.5", provider: "codex", tag: "main", inputPrice: 1.6, outputPrice: 8, cachePrice: 0.2, enabled: true },
  { id: "claude-opus-4-8", provider: "claude", tag: "high", inputPrice: 15, outputPrice: 75, cachePrice: 1.5, enabled: true },
  { id: "gpt-5.3-codex", provider: "codex", tag: "coding", inputPrice: 1.2, outputPrice: 6, cachePrice: 0.16, enabled: true },
  { id: "claude-sonnet-4-6", provider: "claude", tag: "balanced", inputPrice: 3, outputPrice: 15, cachePrice: 0.3, enabled: true },
  { id: "gemini-2.5-pro", provider: "gemini", tag: "long-context", inputPrice: 1.25, outputPrice: 10, cachePrice: 0.125, enabled: true },
  { id: "grok-4.20-fast", provider: "xai", tag: "fast", inputPrice: 0.8, outputPrice: 3.6, cachePrice: 0.1, enabled: true },
  { id: "grok-4.20-0309-console", provider: "xai", tag: "console", inputPrice: 1.1, outputPrice: 5.2, cachePrice: 0.12, enabled: false },
];

const colorMap = {
  "gpt-5.5": "#375984",
  "claude-opus-4-8": "#009d94",
  "gpt-5.3-codex": "#f5df65",
  "claude-sonnet-4-6": "#e94c9c",
  "gemini-2.5-pro": "#7c6cff",
  "grok-4.20-fast": "#22c55e",
  "grok-4.20-0309-console": "#f97316",
};

const navItems = [
  { id: "dashboard", label: "数据看板", icon: LayoutDashboard },
  { id: "models", label: "模型管理", icon: KeyRound },
  { id: "logs", label: "使用日志", icon: List },
  { id: "profile", label: "个人信息", icon: UserRound },
];

function App() {
  const [page, setPage] = useState("dashboard");
  const [activeChart, setActiveChart] = useState("distribution");
  const [models, setModels] = useState(loadModels);
  const [logs, setLogs] = useState(() => buildDemoLogs(loadModels()));
  const [modelSearch, setModelSearch] = useState("");
  const [modelStatus, setModelStatus] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [logProvider, setLogProvider] = useState("all");
  const [logStatus, setLogStatus] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [jsonPaste, setJsonPaste] = useState("");
  const [modelEndpoint, setModelEndpoint] = useState("/model");
  const [modelApiKey, setModelApiKey] = useState("");
  const [toast, setToast] = useState("就绪");
  const [refreshing, setRefreshing] = useState(false);
  const [auth, setAuth] = useState(loadAuthSettings);
  const [session, setSession] = useState(loadSession);
  const [loginOpen, setLoginOpen] = useState(false);

  const isAuthConfigured = Boolean(auth?.passwordHash);
  const isLoggedIn = Boolean(isAuthConfigured && session?.username === auth.username);
  const visibleNavItems = isLoggedIn ? navItems : navItems.filter((item) => item.id === "dashboard");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.models, JSON.stringify(models));
  }, [models]);

  const summary = useMemo(() => getUsageSummary(logs, models), [logs, models]);
  const aggregates = useMemo(() => aggregateByModel(logs, models), [logs, models]);
  const buckets = useMemo(() => buildTimeBuckets(logs, models), [logs, models]);
  const filteredModels = useMemo(
    () => filterModels(models, modelSearch, modelStatus),
    [models, modelSearch, modelStatus],
  );
  const filteredLogs = useMemo(
    () => filterLogs(logs, logSearch, logProvider, logStatus),
    [logs, logSearch, logProvider, logStatus],
  );
  const providerOptions = useMemo(() => unique(logs.map((log) => log.provider)), [logs]);
  const activeModels = models.filter((model) => model.enabled);
  const chartSpec = useMemo(
    () => buildChartSpec(activeChart, buckets, aggregates, summary),
    [activeChart, buckets, aggregates, summary],
  );

  function notify(message) {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast("就绪"), 2600);
  }

  function goPage(nextPage) {
    if (nextPage !== "dashboard" && !isLoggedIn) {
      setLoginOpen(true);
      notify("请先登录后访问管理页面");
      return;
    }
    setPage(nextPage);
  }

  async function handleLoginSubmit({ username, password }) {
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      notify("请输入用户名和密码");
      return;
    }

    const passwordHash = await sha256(password);
    if (!isAuthConfigured) {
      const nextAuth = { username: cleanUsername, passwordHash, updatedAt: new Date().toISOString() };
      saveAuthSettings(nextAuth);
      setAuth(nextAuth);
      const nextSession = { username: cleanUsername, loggedInAt: new Date().toISOString() };
      saveSession(nextSession);
      setSession(nextSession);
      setLoginOpen(false);
      notify("已创建登录账号");
      return;
    }

    if (cleanUsername !== auth.username || passwordHash !== auth.passwordHash) {
      notify("用户名或密码不正确");
      return;
    }

    const nextSession = { username: auth.username, loggedInAt: new Date().toISOString() };
    saveSession(nextSession);
    setSession(nextSession);
    setLoginOpen(false);
    notify("已登录");
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setPage("dashboard");
    notify("已退出登录");
  }

  async function handleProfileSave({ username, currentPassword, nextPassword, confirmPassword }) {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      notify("用户名不能为空");
      return;
    }
    const currentHash = await sha256(currentPassword);
    if (currentHash !== auth.passwordHash) {
      notify("当前密码不正确");
      return;
    }
    if (nextPassword && nextPassword !== confirmPassword) {
      notify("两次输入的新密码不一致");
      return;
    }
    const nextAuth = {
      username: cleanUsername,
      passwordHash: nextPassword ? await sha256(nextPassword) : auth.passwordHash,
      updatedAt: new Date().toISOString(),
    };
    saveAuthSettings(nextAuth);
    setAuth(nextAuth);
    const nextSession = { username: cleanUsername, loggedInAt: new Date().toISOString() };
    saveSession(nextSession);
    setSession(nextSession);
    notify("个人信息已保存");
  }

  function refreshDemo() {
    setRefreshing(true);
    setLogs(buildDemoLogs(models, Date.now()));
    notify("已刷新演示用量数据");
    window.setTimeout(() => setRefreshing(false), 700);
  }

  async function importFromEndpoint() {
    const endpoint = (modelEndpoint || "/model").trim();
    const apiKey = modelApiKey.trim();
    const headers = { accept: "application/json" };
    if (apiKey) headers.Authorization = apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;

    try {
      notify(`正在请求 ${endpoint}...`);
      const response = await fetch(endpoint, {
        headers,
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const count = mergeModels(normalizeModels(payload), setModels);
      notify(`已导入 ${count} 个模型`);
      setPage("models");
    } catch (error) {
      notify(`导入失败：${error.message}`);
    } finally {
      if (apiKey) setModelApiKey("");
    }
  }

  function importPastedJSON() {
    try {
      const count = mergeModels(normalizeModels(JSON.parse(jsonPaste)), setModels);
      setJsonPaste("");
      setImportOpen(false);
      notify(`已导入 ${count} 个模型`);
      setPage("models");
    } catch (error) {
      notify(`JSON 解析失败：${error.message}`);
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const count = mergeModels(normalizeModels(payload), setModels);
      setImportOpen(false);
      notify(`已从文件导入 ${count} 个模型`);
      setPage("models");
    } catch (error) {
      notify(`文件解析失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function updateModel(id, patch) {
    setModels((current) => current.map((model) => (model.id === id ? { ...model, ...patch } : model)));
  }

  function updateModelId(oldId, nextId) {
    const clean = nextId.trim();
    if (!clean) return;
    setModels((current) => current.map((model) => (model.id === oldId ? { ...model, id: clean } : model)));
  }

  function addModel() {
    const id = uniqueModelId(models, "new-model");
    setModels((current) => [{ id, provider: "custom", tag: "manual", inputPrice: 1, outputPrice: 3, cachePrice: 0, enabled: true }, ...current]);
    notify("已新增模型");
  }

  function resetModels() {
    setModels(cloneModels(demoModels));
    setLogs(buildDemoLogs(demoModels, Date.now()));
    notify("已重置模型和演示数据");
  }

  function deleteModel(id) {
    setModels((current) => current.filter((model) => model.id !== id));
    notify("已删除模型");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">控制台</div>
        <nav className="nav-list" aria-label="主导航">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${page === item.id ? "active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => goPage(item.id)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-section">{isLoggedIn ? "数据" : "访问"}</div>
        {isLoggedIn ? (
          <button className="nav-item secondary" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={19} />
            <span>导入模型</span>
          </button>
        ) : (
          <button className="nav-item secondary" type="button" onClick={() => setLoginOpen(true)}>
            <LogIn size={19} />
            <span>{isAuthConfigured ? "登录" : "设置登录"}</span>
          </button>
        )}
        <button className="nav-item secondary" type="button" onClick={refreshDemo}>
          <RefreshCw size={19} className={refreshing ? "spin" : ""} />
          <span>刷新样本</span>
        </button>
        <div className="sidebar-foot">
          <span className="brand-dot" />
          <span>{isLoggedIn ? `已登录：${auth.username}` : "公开数据看板"}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>
              <Sparkles className="hello-icon" size={28} />
              晚上好，linuxdo_13107
            </h1>
            <p className="subtitle">CLIProxy 使用量、模型价格和请求记录的 Cloudflare 前端控制台</p>
          </div>
          <div className="top-actions">
            {isLoggedIn && <span className="user-pill"><ShieldCheck size={16} />{auth.username}</span>}
            <button className="circle-btn" type="button" aria-label="搜索" onClick={() => (isLoggedIn ? goPage(page === "models" ? "models" : "logs") : setLoginOpen(true))}>
              <Search size={21} />
            </button>
            <button className="circle-btn" type="button" aria-label="刷新" onClick={refreshDemo}>
              <RefreshCw size={21} className={refreshing ? "spin" : ""} />
            </button>
            {isLoggedIn ? (
              <button className="circle-btn" type="button" aria-label="退出登录" onClick={handleLogout}>
                <LogOut size={21} />
              </button>
            ) : (
              <button className="primary-btn" type="button" onClick={() => setLoginOpen(true)}>
                <LogIn size={17} />
                {isAuthConfigured ? "登录" : "设置登录"}
              </button>
            )}
          </div>
        </header>

        {page === "dashboard" && (
          <DashboardPage
            summary={summary}
            activeModels={activeModels}
            activeChart={activeChart}
            setActiveChart={setActiveChart}
            chartSpec={chartSpec}
            aggregates={aggregates}
            logs={logs}
            models={models}
            setPage={goPage}
            isLoggedIn={isLoggedIn}
          />
        )}

        {page === "models" && isLoggedIn && (
          <ModelsPage
            models={filteredModels}
            allModels={models}
            modelSearch={modelSearch}
            setModelSearch={setModelSearch}
            modelStatus={modelStatus}
            setModelStatus={setModelStatus}
            modelEndpoint={modelEndpoint}
            setModelEndpoint={setModelEndpoint}
            modelApiKey={modelApiKey}
            setModelApiKey={setModelApiKey}
            importFromEndpoint={importFromEndpoint}
            addModel={addModel}
            resetModels={resetModels}
            updateModel={updateModel}
            updateModelId={updateModelId}
            deleteModel={deleteModel}
            aggregates={aggregates}
            setImportOpen={setImportOpen}
          />
        )}

        {page === "logs" && isLoggedIn && (
          <LogsPage
            rows={filteredLogs}
            logs={logs}
            models={models}
            providerOptions={providerOptions}
            logSearch={logSearch}
            setLogSearch={setLogSearch}
            logProvider={logProvider}
            setLogProvider={setLogProvider}
            logStatus={logStatus}
            setLogStatus={setLogStatus}
          />
        )}

        {page === "profile" && isLoggedIn && (
          <ProfilePage
            auth={auth}
            session={session}
            onSave={handleProfileSave}
            onLogout={handleLogout}
          />
        )}
      </main>

      <ImportModal
        open={importOpen && isLoggedIn}
        onClose={() => setImportOpen(false)}
        jsonPaste={jsonPaste}
        setJsonPaste={setJsonPaste}
        importPastedJSON={importPastedJSON}
        importFile={importFile}
        toast={toast}
      />

      <LoginModal
        open={loginOpen}
        configured={isAuthConfigured}
        username={auth?.username || "admin"}
        onClose={() => setLoginOpen(false)}
        onSubmit={handleLoginSubmit}
        toast={toast}
      />

      <div className="toast" role="status">{toast}</div>
    </div>
  );
}

function DashboardPage({ summary, activeModels, activeChart, setActiveChart, chartSpec, aggregates, logs, models, setPage }) {
  const metricGroups = [
    {
      title: "账户数据",
      icon: Wallet,
      rows: [
        { label: "当前余额", value: 104.23, format: money, icon: CircleDollarSign, color: "blue", action: "充值" },
        { label: "历史消耗", value: summary.cost, format: money, icon: BarChart3, color: "purple" },
      ],
    },
    {
      title: "使用统计",
      icon: Activity,
      rows: [
        { label: "请求次数", value: summary.requests, format: integer, icon: Send, color: "green", spark: summary.series.map((item) => item.requests), sparkColor: "#06b6d4" },
        { label: "统计次数", value: summary.logs, format: integer, icon: Activity, color: "cyan" },
      ],
    },
    {
      title: "资源消耗",
      icon: Zap,
      rows: [
        { label: "统计额度", value: summary.cost, format: money, icon: CircleDollarSign, color: "yellow", spark: summary.series.map((item) => item.cost), sparkColor: "#f59e0b" },
        { label: "统计 Tokens", value: summary.tokens, format: integer, icon: Type, color: "pink" },
      ],
    },
    {
      title: "性能指标",
      icon: Gauge,
      rows: [
        { label: "平均 RPM", value: summary.rpm, format: fixed3, icon: Timer, color: "indigo", spark: summary.series.map((item) => item.tpm), sparkColor: "#6366f1" },
        { label: "平均 TPM", value: summary.tpm, format: fixed3, icon: Type, color: "orange" },
      ],
    },
  ];

  return (
    <section className="page active">
      <div className="metric-grid">
        {metricGroups.map((group, index) => (
          <MetricCard group={group} index={index} key={group.title} />
        ))}
      </div>

      <div className="dashboard-grid">
        <article className="analysis-card motion-card">
          <header className="panel-header">
            <div className="panel-title">
              <PieChart size={18} />
              <strong>模型数据分析</strong>
            </div>
            <div className="chart-tabs" role="tablist">
              {[
                ["distribution", "消耗分布"],
                ["trend", "调用趋势"],
                ["count", "调用次数分布"],
                ["rank", "调用次数排行"],
              ].map(([key, label], index) => (
                <React.Fragment key={key}>
                  {index > 0 && <span>/</span>}
                  <button className={`chart-tab ${activeChart === key ? "active" : ""}`} type="button" onClick={() => setActiveChart(key)}>
                    {label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </header>
          <div className="chart-wrap">
            <VChart key={activeChart} spec={chartSpec} option={chartOption} />
          </div>
        </article>

        <article className="api-card motion-card">
          <header className="panel-header compact">
            <div className="panel-title">
              <Server size={18} />
              <strong>API 信息</strong>
            </div>
          </header>
          <div className="empty-state">
            <div className="empty-illus">
              <Server size={48} />
            </div>
            <h2>暂无 API 信息</h2>
            <p>后面可以接入你的 CLIProxy 节点状态和延迟测试</p>
          </div>
        </article>
      </div>

      <div className="lower-grid">
        <article className="panel motion-card">
          <header className="panel-header compact">
            <div className="panel-title">
              <Tag size={18} />
              <strong>价格概览</strong>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setPage("models")}>管理模型</button>
          </header>
          <div className="price-list">
            {aggregates.slice(0, 6).map((row, index) => (
              <div className="price-item" style={{ "--row-index": index }} key={row.model}>
                <div>
                  <strong title={row.model}>{row.model}</strong>
                  <span>{row.provider} / {integer(row.tokens)} tokens</span>
                </div>
                <strong>{money(row.cost)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel motion-card">
          <header className="panel-header compact">
            <div className="panel-title">
              <Database size={18} />
              <strong>最近请求</strong>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setPage("logs")}>查看日志</button>
          </header>
          <div className="mini-log-list">
            {logs.slice(0, 6).map((log, index) => (
              <div className="mini-log" style={{ "--row-index": index }} key={log.requestId}>
                <div>
                  <strong title={log.model}>{log.model}</strong>
                  <span>{formatTime(log.ts)} / {integer(log.totalTokens)} tokens</span>
                </div>
                <span className={`badge ${log.failed ? "danger" : "success"}`}>{log.failed ? "失败" : "成功"}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function MetricCard({ group, index }) {
  const HeaderIcon = group.icon;
  return (
    <article className="metric-card motion-card" style={{ "--card-index": index }}>
      <header className="card-header">
        <HeaderIcon size={18} />
        <strong>{group.title}</strong>
      </header>
      {group.rows.map((row) => {
        const Icon = row.icon;
        return (
          <div className="metric-row" key={row.label}>
            <span className={`round-icon ${row.color}`}>
              <Icon size={19} />
            </span>
            <div>
              <span className="label">{row.label}</span>
              <strong className="value">
                <CountUp value={row.value} format={row.format} />
              </strong>
            </div>
            {row.action && <button className="mini-pill" type="button">{row.action}</button>}
            {row.spark && <Sparkline values={row.spark} color={row.sparkColor} />}
          </div>
        );
      })}
    </article>
  );
}

function Sparkline({ values, color }) {
  const spec = useMemo(() => ({
    type: "line",
    background: "transparent",
    region: [{ style: { fill: "transparent" } }],
    data: [{ id: "spark", values: values.map((value, index) => ({ index, value })) }],
    xField: "index",
    yField: "value",
    padding: 0,
    axes: [],
    legends: { visible: false },
    line: { style: { stroke: color, lineWidth: 2.2 } },
    point: { visible: false },
    animationAppear: { preset: "clipIn", duration: 650, easing: "cubicOut" },
  }), [values, color]);
  return (
    <div className="sparkline">
      <VChart spec={spec} option={chartOption} />
    </div>
  );
}

function ModelsPage(props) {
  const {
    models,
    allModels,
    modelSearch,
    setModelSearch,
    modelStatus,
    setModelStatus,
    modelEndpoint,
    setModelEndpoint,
    modelApiKey,
    setModelApiKey,
    importFromEndpoint,
    addModel,
    resetModels,
    updateModel,
    updateModelId,
    deleteModel,
    aggregates,
    setImportOpen,
  } = props;
  const enabled = allModels.filter((model) => model.enabled);

  return (
    <section className="page active">
      <div className="section-toolbar">
        <div>
          <h2>模型管理</h2>
          <p>导入 `/model` 测出的 JSON，为每个模型配置输入、输出、缓存价格。</p>
        </div>
        <div className="toolbar-actions">
          <input className="input endpoint-input" value={modelEndpoint} onChange={(event) => setModelEndpoint(event.target.value)} aria-label="模型接口地址" />
          <input
            className="input api-key-input"
            type="password"
            value={modelApiKey}
            onChange={(event) => setModelApiKey(event.target.value)}
            placeholder="临时 API Key（不保存）"
            aria-label="临时 API Key"
            autoComplete="off"
            spellCheck="false"
          />
          <button className="primary-btn" type="button" onClick={importFromEndpoint}><Download size={17} /> 从接口导入</button>
          <button className="ghost-btn" type="button" onClick={() => setImportOpen(true)}><Upload size={17} /> JSON 导入</button>
          <button className="ghost-btn" type="button" onClick={addModel}><Plus size={17} /> 新增模型</button>
        </div>
      </div>

      <div className="model-stats">
        <StatBox label="模型数量" value={allModels.length} />
        <StatBox label="启用模型" value={enabled.length} />
        <StatBox label="平均输入价" value={money(average(enabled.map((model) => model.inputPrice)))} />
        <StatBox label="平均输出价" value={money(average(enabled.map((model) => model.outputPrice)))} />
      </div>

      <article className="panel motion-card">
        <header className="panel-header">
          <div className="panel-title">
            <Boxes size={18} />
            <strong>模型价格表</strong>
          </div>
          <div className="table-tools">
            <input className="input" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型、Provider、标签" />
            <select className="input" value={modelStatus} onChange={(event) => setModelStatus(event.target.value)} aria-label="模型状态筛选">
              <option value="all">全部状态</option>
              <option value="enabled">仅启用</option>
              <option value="disabled">仅停用</option>
            </select>
            <button className="danger-btn" type="button" onClick={resetModels}>重置示例</button>
          </div>
        </header>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>模型</th>
                <th>Provider</th>
                <th>标签</th>
                <th>输入 / 1M</th>
                <th>输出 / 1M</th>
                <th>缓存 / 1M</th>
                <th>估算成本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model, index) => {
                const usage = aggregates.find((row) => row.model === model.id);
                return (
                  <tr style={{ "--row-index": index }} key={model.id}>
                    <td>
                      <button className={`switch ${model.enabled ? "on" : ""}`} type="button" onClick={() => updateModel(model.id, { enabled: !model.enabled })} aria-label="切换状态" />
                    </td>
                    <td><input className="table-input name-input" value={model.id} onChange={(event) => updateModelId(model.id, event.target.value)} /></td>
                    <td><input className="table-input" value={model.provider} onChange={(event) => updateModel(model.id, { provider: event.target.value })} /></td>
                    <td><input className="table-input tag-input" value={model.tag || ""} onChange={(event) => updateModel(model.id, { tag: event.target.value })} /></td>
                    <td><NumberInput value={model.inputPrice} onChange={(value) => updateModel(model.id, { inputPrice: value })} /></td>
                    <td><NumberInput value={model.outputPrice} onChange={(value) => updateModel(model.id, { outputPrice: value })} /></td>
                    <td><NumberInput value={model.cachePrice} onChange={(value) => updateModel(model.id, { cachePrice: value })} /></td>
                    <td className="strong">{money(usage?.cost || 0)}</td>
                    <td><button className="ghost-btn compact" type="button" onClick={() => deleteModel(model.id)}><Trash2 size={15} /> 删除</button></td>
                  </tr>
                );
              })}
              {!models.length && <tr><td colSpan="9">没有匹配的模型，可以从 /model 导入，或手动新增。</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function LogsPage({ rows, logs, models, providerOptions, logSearch, setLogSearch, logProvider, setLogProvider, logStatus, setLogStatus }) {
  return (
    <section className="page active">
      <div className="section-toolbar">
        <div>
          <h2>使用日志</h2>
          <p>查看按模型价格估算后的请求成本、Token 和状态。</p>
        </div>
        <div className="toolbar-actions">
          <input className="input" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="搜索模型或请求 ID" />
          <select className="input" value={logProvider} onChange={(event) => setLogProvider(event.target.value)} aria-label="Provider 筛选">
            <option value="all">全部 Provider</option>
            {providerOptions.map((provider) => <option value={provider} key={provider}>{provider}</option>)}
          </select>
          <select className="input" value={logStatus} onChange={(event) => setLogStatus(event.target.value)} aria-label="状态筛选">
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
        </div>
      </div>
      <article className="panel motion-card">
        <header className="panel-header compact">
          <div className="panel-title">
            <List size={18} />
            <strong>请求记录</strong>
          </div>
          <span className="muted">{rows.length} 条 / 共 {logs.length} 条</span>
        </header>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>Provider</th>
                <th>模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存</th>
                <th>总 Tokens</th>
                <th>估算成本</th>
                <th>状态</th>
                <th>延迟</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log, index) => (
                <tr style={{ "--row-index": index }} key={log.requestId}>
                  <td>{formatDateTime(log.ts)}</td>
                  <td>{log.provider}</td>
                  <td className="strong">{log.model}</td>
                  <td>{integer(log.inputTokens)}</td>
                  <td>{integer(log.outputTokens)}</td>
                  <td>{integer(log.cachedTokens)}</td>
                  <td className="strong">{integer(log.totalTokens)}</td>
                  <td className="strong">{money(costForLog(log, models))}</td>
                  <td><span className={`badge ${log.failed ? "danger" : "success"}`}>{log.failed ? `失败 ${log.status}` : "成功"}</span></td>
                  <td>{integer(log.latency)}ms</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="10">没有匹配的日志。</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function ProfilePage({ auth, session, onSave, onLogout }) {
  const [username, setUsername] = useState(auth.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setUsername(auth.username);
  }, [auth.username]);

  async function submit(event) {
    event.preventDefault();
    await onSave({ username, currentPassword, nextPassword, confirmPassword });
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
  }

  return (
    <section className="page active">
      <div className="section-toolbar">
        <div>
          <h2>个人信息</h2>
          <p>设置本地登录用户名和密码。这个登录层用于前端界面访问控制，真正公开部署仍建议加 Cloudflare Access。</p>
        </div>
        <div className="toolbar-actions">
          <button className="danger-btn" type="button" onClick={onLogout}>
            <LogOut size={17} />
            退出登录
          </button>
        </div>
      </div>

      <div className="profile-grid">
        <article className="panel auth-card motion-card">
          <header className="panel-header compact">
            <div className="panel-title">
              <UserRound size={18} />
              <strong>账号设置</strong>
            </div>
          </header>
          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span>用户名</span>
              <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <SecureInput label="当前密码" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <SecureInput label="新密码" value={nextPassword} onChange={setNextPassword} autoComplete="new-password" placeholder="留空则不修改密码" />
            <SecureInput label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="再次输入新密码" />
            <div className="form-actions">
              <button className="primary-btn" type="submit">
                <ShieldCheck size={17} />
                保存个人信息
              </button>
            </div>
          </form>
        </article>

        <article className="panel auth-card motion-card" style={{ "--card-index": 1 }}>
          <header className="panel-header compact">
            <div className="panel-title">
              <LockKeyhole size={18} />
              <strong>登录状态</strong>
            </div>
          </header>
          <div className="auth-summary">
            <div className="summary-row">
              <span>当前用户</span>
              <strong>{auth.username}</strong>
            </div>
            <div className="summary-row">
              <span>登录时间</span>
              <strong>{session?.loggedInAt ? formatDateTime(session.loggedInAt) : "未知"}</strong>
            </div>
            <div className="summary-row">
              <span>密码更新时间</span>
              <strong>{auth.updatedAt ? formatDateTime(auth.updatedAt) : "未知"}</strong>
            </div>
            <div className="security-note">
              <ShieldCheck size={18} />
              <p>用户名和密码哈希保存在当前浏览器 localStorage。它适合防误入和个人使用，不适合作为公网强安全边界。</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function LoginModal({ open, configured, username, onClose, onSubmit, toast }) {
  const [loginName, setLoginName] = useState(username);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setLoginName(username);
      setPassword("");
    }
  }, [open, username]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    await onSubmit({ username: loginName, password });
  }

  return (
    <div className="modal open" role="presentation">
      <div className="modal-panel auth-modal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <header className="modal-header">
          <div>
            <h2 id="loginTitle">{configured ? "登录控制台" : "设置登录账号"}</h2>
            <p>{configured ? "登录后可以访问模型管理、使用日志和个人信息。" : "首次使用先创建一个本地用户名和密码。"}</p>
          </div>
          <button className="circle-btn" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
        </header>
        <form className="modal-body auth-form" onSubmit={submit}>
          <label className="field">
            <span>用户名</span>
            <input className="input" value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" />
          </label>
          <SecureInput label="密码" value={password} onChange={setPassword} autoComplete={configured ? "current-password" : "new-password"} />
          <div className="security-note">
            <LockKeyhole size={18} />
            <p>未登录时只展示数据看板。这个本地登录不会隐藏前端源码，公网强保护请再套 Cloudflare Access。</p>
          </div>
          <footer className="modal-footer inline-footer">
            <span className="muted">{toast}</span>
            <div>
              <button className="ghost-btn" type="button" onClick={onClose}>取消</button>
              <button className="primary-btn" type="submit">
                <LogIn size={17} />
                {configured ? "登录" : "创建并登录"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function SecureInput({ label, value, onChange, autoComplete, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="password-input">
        <input
          className="input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

function ImportModal({ open, onClose, jsonPaste, setJsonPaste, importPastedJSON, importFile, toast }) {
  if (!open) return null;
  return (
    <div className="modal open" role="presentation">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="importTitle">
        <header className="modal-header">
          <div>
            <h2 id="importTitle">导入模型 JSON</h2>
            <p>支持 OpenAI `/models`、字符串数组、对象数组、对象映射等格式。</p>
          </div>
          <button className="circle-btn" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="modal-body">
          <label className="file-drop">
            <input type="file" accept=".json,application/json" onChange={importFile} />
            <Upload size={28} />
            <strong>选择 JSON 文件</strong>
            <small>或直接在下面粘贴内容</small>
          </label>
          <textarea className="json-area" value={jsonPaste} onChange={(event) => setJsonPaste(event.target.value)} placeholder='例如：{"data":[{"id":"gpt-5.5"}]}' />
        </div>
        <footer className="modal-footer">
          <span className="muted">{toast}</span>
          <div>
            <button className="ghost-btn" type="button" onClick={onClose}>取消</button>
            <button className="primary-btn" type="button" onClick={importPastedJSON}>导入粘贴内容</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function CountUp({ value, format }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      previous.current = value;
      setDisplay(value);
      return;
    }
    const from = Number(previous.current) || 0;
    const to = Number(value) || 0;
    const start = performance.now();
    const duration = 620;
    let frame = 0;
    function tick(now) {
      const raw = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      setDisplay(from + (to - from) * eased);
      if (raw < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return format(display);
}

function StatBox({ label, value }) {
  return (
    <div className="stat-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NumberInput({ value, onChange }) {
  return (
    <input
      className="table-input"
      type="number"
      min="0"
      step="0.001"
      value={value}
      onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
    />
  );
}

function buildChartSpec(activeChart, buckets, aggregates, summary) {
  if (activeChart === "trend") return trendSpec(buckets, summary.logs);
  if (activeChart === "count") return pieSpec(aggregates, summary.logs);
  if (activeChart === "rank") return rankSpec(aggregates, summary.logs);
  return distributionSpec(buckets, summary.cost);
}

function baseChart(title, subtext) {
  return {
    background: "transparent",
    title: {
      visible: true,
      text: title,
      subtext,
      textStyle: { fill: "#f8fafc", fontSize: 21, fontWeight: 800 },
      subtextStyle: { fill: "#9ca3af", fontSize: 15 },
    },
    legends: {
      visible: true,
      orient: "bottom",
      item: {
        label: { style: { fill: "#d1d5db" } },
      },
    },
    tooltip: {
      style: {
        panel: { backgroundColor: "#171922", borderColor: "#282a33" },
        titleLabel: { fill: "#f8fafc" },
        keyLabel: { fill: "#d1d5db" },
        valueLabel: { fill: "#f8fafc" },
      },
    },
  };
}

function axisStyle(options = {}) {
  const leftTick = { visible: false };
  if (Number.isFinite(options.tickStep)) leftTick.tickStep = options.tickStep;
  if (Number.isFinite(options.tickCount)) leftTick.tickCount = options.tickCount;
  if (options.noDecimals) leftTick.noDecimals = true;

  const leftAxis = {
    orient: "left",
    min: 0,
    label: {
      formatMethod: options.labelFormatter,
      style: { fill: "#f8fafc" },
    },
    grid: { visible: true, style: { stroke: "#282a33", lineWidth: 1 } },
    domainLine: { visible: false },
    tick: leftTick,
  };

  if (Number.isFinite(options.max)) {
    leftAxis.max = options.max;
    leftAxis.nice = false;
  }

  return [
    leftAxis,
    {
      orient: "bottom",
      label: { style: { fill: "#f8fafc" } },
      grid: { visible: false },
      domainLine: { style: { stroke: "#282a33" } },
      tick: { visible: false },
    },
  ];
}

function countAxis(values) {
  const maxValue = Math.max(1, ...values.map((value) => Math.ceil(Number(value) || 0)));
  const tickStep = niceIntegerStep(maxValue / 5);
  let max = Math.ceil(maxValue / tickStep) * tickStep;
  if (max <= maxValue) max += tickStep;
  return {
    max,
    tickStep,
    tickCount: Math.floor(max / tickStep) + 1,
    noDecimals: true,
    labelFormatter: (value) => integer(Number(value) || 0),
  };
}

function niceIntegerStep(value) {
  const raw = Math.max(1, Number(value) || 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, nice * magnitude);
}

function distributionSpec(buckets, totalCost) {
  return {
    ...baseChart("模型消耗分布", `总计：${money(totalCost)}`),
    type: "bar",
    data: [{ id: "barData", values: buckets.flatMap((bucket) => bucket.models.map((item) => ({ Time: bucket.label, Model: item.model, Usage: item.cost }))) }],
    xField: "Time",
    yField: "Usage",
    seriesField: "Model",
    stack: true,
    axes: axisStyle(),
    padding: { top: 62, right: 28, bottom: 44, left: 56 },
    color: { specified: colorMap },
    bar: { style: { cornerRadius: 2 }, state: { hover: { stroke: "#000", lineWidth: 1 } } },
    animationAppear: { preset: "grow", duration: 820, easing: "cubicOut" },
  };
}

function trendSpec(buckets, total) {
  const values = buckets.flatMap((bucket) => bucket.models.map((item) => ({ Time: bucket.label, Model: item.model, Count: item.count })));
  return {
    ...baseChart("调用趋势", `总计：${integer(total)}`),
    type: "line",
    data: [{ id: "lineData", values }],
    xField: "Time",
    yField: "Count",
    seriesField: "Model",
    axes: axisStyle(countAxis(values.map((item) => item.Count))),
    padding: { top: 62, right: 28, bottom: 44, left: 56 },
    color: { specified: colorMap },
    line: { style: { lineWidth: 2.4 } },
    point: { visible: true, style: { size: 8, stroke: "#111216", lineWidth: 1 } },
    animationAppear: { preset: "clipIn", duration: 850, easing: "cubicOut" },
  };
}

function pieSpec(aggregates, total) {
  return {
    ...baseChart("模型调用次数占比", `总计：${integer(total)}`),
    type: "pie",
    data: [{ id: "pieData", values: aggregates.slice(0, 8).map((row) => ({ type: row.model, value: row.count })) }],
    outerRadius: 0.72,
    innerRadius: 0.48,
    padAngle: 0.8,
    valueField: "value",
    categoryField: "type",
    color: { specified: colorMap },
    legends: { visible: true, orient: "left", item: { label: { style: { fill: "#d1d5db" } } } },
    label: { visible: true, style: { fill: "#f8fafc" } },
    pie: { style: { cornerRadius: 9 }, state: { hover: { outerRadius: 0.78, stroke: "#000", lineWidth: 1 } } },
    animationAppear: { preset: "growRadius", duration: 850, easing: "cubicOut" },
  };
}

function rankSpec(aggregates, total) {
  const values = aggregates.slice(0, 8).map((row) => ({ Model: row.model, Count: row.count }));
  return {
    ...baseChart("模型调用次数排行", `总计：${integer(total)}`),
    type: "bar",
    data: [{ id: "rankData", values }],
    xField: "Model",
    yField: "Count",
    seriesField: "Model",
    axes: axisStyle(countAxis(values.map((item) => item.Count))),
    padding: { top: 62, right: 28, bottom: 44, left: 56 },
    color: { specified: colorMap },
    bar: { style: { cornerRadius: 2 }, state: { hover: { stroke: "#000", lineWidth: 1 } } },
    animationAppear: { preset: "grow", duration: 820, easing: "cubicOut" },
  };
}

function loadModels() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.models));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    // Keep the demo defaults when localStorage is empty or broken.
  }
  return cloneModels(demoModels);
}

function loadAuthSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.auth));
    if (saved?.username && saved?.passwordHash) return saved;
  } catch {
    // Ignore broken auth state and let the user create credentials again.
  }
  return { username: "admin", passwordHash: "", updatedAt: "" };
}

function saveAuthSettings(auth) {
  localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(auth));
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.session));
    if (saved?.username) return saved;
  } catch {
    // Ignore broken session state.
  }
  return null;
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  if (!globalThis.crypto?.subtle) {
    return Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeModels(payload) {
  const list = extractModelList(payload);
  return list.map((item) => {
    const id = getModelId(item);
    if (!id) return null;
    return {
      id,
      provider: getProvider(item, id),
      tag: getTag(item),
      inputPrice: numberFrom(item?.inputPrice ?? item?.input_price ?? item?.prompt_price, defaultInputPrice(id)),
      outputPrice: numberFrom(item?.outputPrice ?? item?.output_price ?? item?.completion_price, defaultOutputPrice(id)),
      cachePrice: numberFrom(item?.cachePrice ?? item?.cache_price ?? item?.cached_price, defaultCachePrice(id)),
      enabled: typeof item?.enabled === "boolean" ? item.enabled : true,
    };
  }).filter(Boolean);
}

function extractModelList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload?.model_list)) return payload.model_list;
  if (payload && typeof payload === "object") {
    return Object.entries(payload).map(([key, value]) => (value && typeof value === "object" && !Array.isArray(value) ? { id: key, ...value } : { id: key, value }));
  }
  return [];
}

function mergeModels(incoming, setModels) {
  setModels((current) => {
    const map = new Map(current.map((model) => [model.id, model]));
    incoming.forEach((model) => map.set(model.id, { ...map.get(model.id), ...model }));
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  });
  return incoming.length;
}

function getModelId(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  return String(item.id ?? item.name ?? item.model ?? item.model_name ?? item.value ?? "").trim();
}

function getProvider(item, id) {
  const explicit = typeof item === "object" ? item.provider ?? item.owned_by ?? item.vendor : "";
  if (explicit) return String(explicit).trim().toLowerCase();
  const lower = id.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("grok")) return "xai";
  if (lower.includes("gpt") || lower.includes("codex")) return "codex";
  if (lower.includes("deepseek")) return "deepseek";
  return "custom";
}

function getTag(item) {
  if (!item || typeof item !== "object") return "imported";
  return String(item.tag ?? item.group ?? item.category ?? item.type ?? "imported").trim();
}

function buildDemoLogs(models, seed = Date.now()) {
  const active = models.filter((model) => model.enabled);
  const pool = active.length ? active : demoModels;
  return Array.from({ length: 72 }, (_, index) => {
    const model = pool[index % pool.length];
    const inputTokens = 1400 + ((index * 997) % 78000);
    const outputTokens = 700 + ((index * 613) % 32000);
    const cachedTokens = index % 3 === 0 ? inputTokens * 2 : 0;
    return {
      ts: new Date(seed - index * 17 * 60 * 1000).toISOString(),
      requestId: `req-${seed.toString(36).slice(-4)}-${String(index).padStart(3, "0")}`,
      provider: model.provider,
      model: model.id,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
      failed: index % 23 === 0,
      status: index % 23 === 0 ? 504 : 200,
      latency: 360 + ((index * 73) % 3200),
    };
  });
}

function getUsageSummary(logs, models) {
  const tokens = logs.reduce((sum, log) => sum + log.totalTokens, 0);
  const cost = logs.reduce((sum, log) => sum + costForLog(log, models), 0);
  const requests = logs.length;
  const minutes = 24 * 60;
  return {
    requests,
    logs: requests,
    tokens,
    cost,
    rpm: requests / minutes,
    tpm: tokens / minutes,
    series: buildTimeBuckets(logs, models),
  };
}

function aggregateByModel(logs, models) {
  const map = new Map();
  logs.forEach((log) => {
    const item = map.get(log.model) || { model: log.model, provider: log.provider, cost: 0, count: 0, tokens: 0 };
    item.cost += costForLog(log, models);
    item.count += 1;
    item.tokens += log.totalTokens;
    map.set(log.model, item);
  });
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

function buildTimeBuckets(logs, models) {
  const topModels = models.filter((model) => model.enabled).slice(0, 4).map((model) => model.id);
  const now = Date.now();
  return Array.from({ length: 7 }, (_, index) => {
    const start = now - (6 - index) * 60 * 60 * 1000;
    const end = start + 60 * 60 * 1000;
    const dt = new Date(start);
    const label = `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:00`;
    const hourLogs = logs.filter((log) => {
      const time = new Date(log.ts).getTime();
      return time >= start && time < end;
    });
    const modelsInBucket = topModels.map((modelId) => {
      const rows = hourLogs.filter((log) => log.model === modelId);
      return {
        model: modelId,
        count: rows.length,
        cost: rows.reduce((sum, log) => sum + costForLog(log, models), 0),
      };
    });
    return {
      label,
      requests: hourLogs.length,
      cost: hourLogs.reduce((sum, log) => sum + costForLog(log, models), 0),
      tpm: hourLogs.reduce((sum, log) => sum + log.totalTokens, 0) / 60,
      models: modelsInBucket,
    };
  });
}

function costForLog(log, models) {
  const model = models.find((item) => item.id === log.model);
  if (!model) return 0;
  return (log.inputTokens / 1_000_000) * model.inputPrice +
    (log.outputTokens / 1_000_000) * model.outputPrice +
    (log.cachedTokens / 1_000_000) * model.cachePrice;
}

function filterModels(models, search, status) {
  const q = search.trim().toLowerCase();
  return models.filter((model) => {
    const haystack = `${model.id} ${model.provider} ${model.tag}`.toLowerCase();
    const matchSearch = !q || haystack.includes(q);
    const matchStatus = status === "all" || (status === "enabled" && model.enabled) || (status === "disabled" && !model.enabled);
    return matchSearch && matchStatus;
  });
}

function filterLogs(logs, search, provider, status) {
  const q = search.trim().toLowerCase();
  return logs.filter((log) => {
    const haystack = `${log.model} ${log.provider} ${log.requestId}`.toLowerCase();
    const matchSearch = !q || haystack.includes(q);
    const matchProvider = provider === "all" || log.provider === provider;
    const matchStatus = status === "all" || (status === "success" && !log.failed) || (status === "failed" && log.failed);
    return matchSearch && matchProvider && matchStatus;
  });
}

function uniqueModelId(models, base) {
  let id = base;
  let index = 1;
  while (models.some((model) => model.id === id)) id = `${base}-${index++}`;
  return id;
}

function cloneModels(models) {
  return models.map((model) => ({ ...model }));
}

function defaultInputPrice(id) {
  const lower = id.toLowerCase();
  if (lower.includes("opus")) return 15;
  if (lower.includes("claude")) return 3;
  if (lower.includes("gemini")) return 1.25;
  if (lower.includes("mini")) return 0.2;
  return 1;
}

function defaultOutputPrice(id) {
  const lower = id.toLowerCase();
  if (lower.includes("opus")) return 75;
  if (lower.includes("claude")) return 15;
  if (lower.includes("gemini")) return 10;
  if (lower.includes("mini")) return 0.8;
  return 3;
}

function defaultCachePrice(id) {
  return defaultInputPrice(id) * 0.1;
}

function numberFrom(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function average(values) {
  const real = values.filter((value) => Number.isFinite(Number(value)));
  if (!real.length) return 0;
  return real.reduce((sum, value) => sum + Number(value), 0) / real.length;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function integer(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function fixed3(value) {
  return Number(value || 0).toFixed(3);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

createRoot(document.getElementById("root")).render(<App />);
