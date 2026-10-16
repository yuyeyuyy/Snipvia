import type { EditingContextRequest } from '../../../shared/agent/editing';
import { AppearanceSettings } from './AppearanceSettings';
import { UpdateSettings } from './UpdateSettings';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LoginItemState, PublicSettings, Settings } from '../../../shared/contracts';
import type { NotebookReference } from '../../../shared/notes';
import { predictionApplicableContent, type PredictionBranch } from '../../../shared/screenshot-understanding';
import { credentialScope, modelProfileLabel, providerEndpoints, providerFor, providers, retiredProviderIds, type ProviderId } from '../../../shared/providers';
import { ModelSelectRow } from './ModelSelectRow';
import { Icon } from '../components/Icon';
import { Button, IconButton, Input, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { version } from '../../../../package.json';
import { acceleratorFromKeyboardEvent, formatAccelerator, isModifierKey } from './shortcut';
import './settings.css';

type Status = { kind: 'success' | 'error'; message: string } | null;

function settingsValue(settings: PublicSettings, override: Partial<Settings> = {}): Settings {
  return {
    provider: override.provider ?? settings.provider,
    endpoint: override.endpoint ?? settings.endpoint,
    model: override.model ?? settings.model,
    shortcut: override.shortcut ?? settings.shortcut,
    continueShortcut: override.continueShortcut ?? settings.continueShortcut,
    editorShortcut: override.editorShortcut ?? settings.editorShortcut,
    predictionBranches: override.predictionBranches ?? settings.predictionBranches
  };
}

function ShortcutRecorder({ label, value, disabled, onCommit, onInvalid }: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit(value: string): Promise<boolean>;
  onInvalid(message: string): void;
}) {
  const [recording, setRecording] = useState(false);

  function keyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { setRecording(false); return; }
    if (isModifierKey(event.key)) return;
    const accelerator = acceleratorFromKeyboardEvent(event.nativeEvent, window.snipvia.platform);
    if (!accelerator) {
      onInvalid('请按下修饰键与字母、数字或功能键的组合');
      return;
    }
    setRecording(false);
    void onCommit(accelerator);
  }

  return <Button
    type="button"
    className={`shortcut-recorder ${recording ? 'recording' : ''}`}
    aria-label={label}
    aria-pressed={recording}
    disabled={disabled}
    onClick={() => setRecording(true)}
    onBlur={() => setRecording(false)}
    onKeyDown={keyDown}
  >
    <kbd>{recording ? '按下组合键…' : formatAccelerator(value, window.snipvia.platform)}</kbd>
  </Button>;
}

export function SettingsPanel({ settings, onSaved, onDiscuss }: { settings: PublicSettings; onSaved(value: PublicSettings): void; onDiscuss?(context: EditingContextRequest): Promise<void> }) {
  const [form, setForm] = useState(settings);
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const [configDialog, setConfigDialog] = useState(false);
  const [privacyDialog, setPrivacyDialog] = useState(false);
  const [predictionDialog, setPredictionDialog] = useState(false);
  const [editingPrediction, setEditingPrediction] = useState<PredictionBranch | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookReference[]>([]);
  const [predictionDraft, setPredictionDraft] = useState({ label: '', applicableContent: '', prompt: '', notebookId: '' });
  const [loginItem, setLoginItem] = useState<LoginItemState | null>(null);
  const customProvider = form.provider === 'custom' || retiredProviderIds.includes(form.provider);
  const provider = providerFor(customProvider ? 'custom' : form.provider);
  const endpoints = providerEndpoints(form.provider);
  const namedEndpoint = endpoints.some((entry) => entry.url === form.endpoint.replace(/\/+$/, ''));
  const hasKey = settings.configuredServices.includes(credentialScope(form));
  const activeScope = credentialScope(settings);
  const predictionTitle = editingPrediction ? '编辑预测分支' : '新增预测分支';
  const promptRequired = !editingPrediction || editingPrediction.mode === 'ai';

  useEffect(() => {
    let active = true;
    const refresh = () => { void window.snipvia.notes.state().then((result) => { if (active && result.ok) setNotebooks(result.value.notebooks); }); };
    refresh(); window.addEventListener('focus', refresh);
    const stop = window.snipvia.notes.onChanged(refresh);
    return () => { active = false; stop(); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void window.snipvia.settings.loginItem().then((result) => {
        if (!active) return;
        if (result.ok) setLoginItem(result.value);
        else setStatus({ kind: 'error', message: result.error });
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);

  function selectProvider(id: ProviderId) {
    if (id === form.provider) return;
    const next = providerFor(id);
    const saved = settings.configuredModels.find((profile) => profile.provider === id);
    const model = saved?.model ?? next.models[0]?.id ?? '';
    setForm({ ...form, provider: id, endpoint: saved?.endpoint ?? next.endpoint, model });
    setKey('');
    setClearKey(false);
    setStatus(null);
  }

  function openConfigDialog() {
    setForm(settings);
    setKey('');
    setClearKey(false);
    setStatus(null);
    setConfigDialog(true);
  }

  async function saveImmediate(value: Settings, message: string) {
    if (saving) return false;
    setSaving(true);
    setStatus(null);
    const result = await window.snipvia.settings.save(value);
    if (result.ok) {
      onSaved(result.value);
      setStatus({ kind: 'success', message });
      setSaving(false);
      return true;
    }
    setStatus({ kind: 'error', message: result.error });
    setSaving(false);
    return false;
  }

  async function chooseConfiguredModel(scope: string) {
    const profile = settings.configuredModels.find((item) => credentialScope(item) === scope);
    if (!profile || scope === activeScope) return;
    await saveImmediate(settingsValue(settings, profile), `已切换为 ${modelProfileLabel(profile, settings.configuredModels)}`);
  }

  async function changeShortcut(value: string) {
    return saveImmediate(settingsValue(settings, { shortcut: value }), '快捷键已生效');
  }

  async function changeContinueShortcut(value: string) {
    return saveImmediate(settingsValue(settings, { continueShortcut: value }), '继续对话快捷键已生效');
  }

  async function changePredictionBranches(branches: PredictionBranch[], message: string) {
    return saveImmediate(settingsValue(settings, { predictionBranches: branches }), message);
  }

  async function togglePredictionBranch(id: string, enabled: boolean) {
    await changePredictionBranches(
      settings.predictionBranches.map((branch) => branch.id === id ? { ...branch, enabled } : branch),
      enabled ? '预测分支已开启' : '预测分支已关闭'
    );
  }

  async function removePredictionBranch(id: string) {
    await changePredictionBranches(settings.predictionBranches.filter((branch) => branch.id !== id), '自定义预测分支已删除');
  }

  function openPredictionDialog(branch?: PredictionBranch) {
    setEditingPrediction(branch ?? null);
    setPredictionDraft(branch ? { label: branch.label, applicableContent: predictionApplicableContent(branch), prompt: branch.prompt, notebookId: branch.notebookId ?? '' } : { label: '', applicableContent: '', prompt: '', notebookId: '' });
    setStatus(null);
    setPredictionDialog(true);
  }

  async function changeLoginItem(enabled: boolean) {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    const result = await window.snipvia.settings.setLoginItem(enabled);
    if (result.ok) {
      setLoginItem(result.value);
      setStatus({ kind: 'success', message: enabled ? '开机自启已开启' : '开机自启已关闭' });
    } else setStatus({ kind: 'error', message: result.error });
    setSaving(false);
  }

  return <section className="settings-panel settings-preferences">
    <header className="settings-page-heading">
      <div><h1>设置</h1><p>更改会自动应用到截然。</p></div>
      <IconButton icon="info" label="查看隐私说明" onClick={() => setPrivacyDialog(true)} />
    </header>

    <nav className="settings-categories" aria-label="设置分类">
      {[
        ['general-settings-title', '通用'], ['appearance-settings-title', '外观'], ['model-settings-title', '模型配置'],
        ['shortcut-settings-title', '快捷键'], ['privacy-settings-title', '隐私与数据'], ['about-settings-title', '关于']
      ].map(([id, label]) => <Button variant="quiet" key={id} onClick={() => {
        const heading = document.getElementById(id); heading?.scrollIntoView({ block: 'start' }); heading?.focus({ preventScroll: true });
      }}>{label}</Button>)}
    </nav>
    <section className="preference-section" aria-labelledby="general-settings-title">
      <h2 tabIndex={-1} id="general-settings-title">通用</h2>
      <div className="preference-card">
        <div className="preference-row">
          <div className="preference-copy"><strong>开机自启</strong><span>{loginItem?.description ?? '正在读取系统启动设置…'}</span></div>
          <label className="config-checkbox">
            <input type="checkbox" aria-label="开机自启" checked={loginItem?.enabled ?? false} disabled={saving || !loginItem?.supported} onChange={(event) => void changeLoginItem(event.target.checked)} />
            <span />
          </label>
        </div>
      </div>
    </section>

    <AppearanceSettings />
    <section className="preference-section" aria-labelledby="model-settings-title">
      <h2 tabIndex={-1} id="model-settings-title">模型配置</h2>
      <div className="preference-card">
        <div className="preference-row">
          <div className="preference-copy"><strong>选择厂商</strong><span>选择已配置的截图对话模型；分支预测使用后台配置</span></div>
          <Select className="preference-select" aria-label="选择厂商" value={activeScope} disabled={saving} onChange={(event) => void chooseConfiguredModel(event.target.value)}>
            {settings.configuredModels.map((profile) => <option key={credentialScope(profile)} value={credentialScope(profile)}>{modelProfileLabel(profile, settings.configuredModels)}</option>)}
          </Select>
        </div>
        <div className="preference-row">
          <div className="preference-copy"><strong>配置厂商</strong><span>添加或更新模型、接口地址与 API Key</span></div>
          <Button type="button" className="preference-action" onClick={openConfigDialog}>配置…</Button>
        </div>
      </div>
    <div className="preference-subsection" aria-labelledby="prediction-settings-title">
      <h3 id="prediction-settings-title">截图预测</h3>
      <div className="preference-card prediction-card">
        {settings.predictionBranches.map((branch) => <div className="preference-row prediction-row" key={branch.id}>
          <div className="preference-copy">
            <strong>{branch.label}</strong>
            <span>{predictionApplicableContent(branch)}{branch.builtin ? '' : ' · 自定义分支'}</span>
          </div>
          <div className="prediction-controls">
            <Button type="button" className="preference-action" aria-label={`编辑${branch.label}`} disabled={saving} onClick={() => openPredictionDialog(branch)}>编辑…</Button>
            {!branch.builtin && <Button variant="quiet" type="button" className="prediction-remove" aria-label={`删除${branch.label}`} title="删除分支" disabled={saving} onClick={() => void removePredictionBranch(branch.id)}><Icon name="close" size={13} /></Button>}
            <label className="config-checkbox">
              <input type="checkbox" aria-label={`${branch.enabled ? '关闭' : '开启'}${branch.label}`} checked={branch.enabled} disabled={saving} onChange={(event) => void togglePredictionBranch(branch.id, event.target.checked)} />
              <span />
            </label>
          </div>
        </div>)}
        <div className="prediction-add-row">
          <Button variant="quiet" type="button" className="prediction-add" onClick={() => openPredictionDialog()} disabled={saving}>
            <Icon name="plus" size={15} />新增预测分支
          </Button>
        </div>
      </div>
    </div>
    </section>

    <section className="preference-section" aria-labelledby="shortcut-settings-title">
      <h2 tabIndex={-1} id="shortcut-settings-title">快捷键</h2>
      <div className="preference-card">
        <div className="preference-row">
          <div className="preference-copy"><strong>普通截图</strong><span>框选后标注、复制、保存或贴图；点击「问 AI」进入智能流程</span></div>
          <ShortcutRecorder label="设置普通截图快捷键" value={settings.editorShortcut} disabled={saving} onCommit={(value) => saveImmediate(settingsValue(settings, { editorShortcut: value }), '普通截图快捷键已生效')} onInvalid={(message) => setStatus({ kind: 'error', message })} />
        </div>
        <div className="preference-row">
          <div className="preference-copy"><strong>截图快捷键</strong><span>框选屏幕区域并自动理解截图内容</span></div>
          <ShortcutRecorder label="设置截图快捷键" value={settings.shortcut} disabled={saving} onCommit={changeShortcut} onInvalid={(message) => setStatus({ kind: 'error', message })} />
        </div>
        <div className="preference-row">
          <div className="preference-copy"><strong>续拍并继续对话</strong><span>重新截图，跳过意图分析，并沿用最近一次对话的上下文</span></div>
          <ShortcutRecorder label="设置继续对话快捷键" value={settings.continueShortcut} disabled={saving} onCommit={changeContinueShortcut} onInvalid={(message) => setStatus({ kind: 'error', message })} />
        </div>
      </div>
    </section>


    <section className="preference-section" aria-labelledby="privacy-settings-title">
      <h2 tabIndex={-1} id="privacy-settings-title">隐私与数据</h2>
      <div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>截图与对话</strong><span>保存在本机；可在历史对话中单项删除或清空</span></div><Button className="preference-action" onClick={() => setPrivacyDialog(true)}>隐私说明…</Button></div>
        <div className="preference-row"><div className="preference-copy"><strong>笔记与附件</strong><span>使用你选择的文件夹；Markdown 与 assets 附件可直接备份</span></div><span className="preference-value">本地文件</span></div>
        <div className="preference-row"><div className="preference-copy"><strong>模型凭据</strong><span>API Key 由系统凭据保护，更新与移除请打开厂商配置</span></div><span className="preference-value">系统加密</span></div>
      </div>
    </section>
    <section className="preference-section" aria-labelledby="about-settings-title">
      <h2 tabIndex={-1} id="about-settings-title">关于</h2>
      <div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>截然 · Snipvia</strong><span>截图、对话与本地 Markdown 笔记</span></div><span className="preference-value">v{version}</span></div>
        <UpdateSettings />
        <div className="preference-row"><div className="preference-copy"><strong>当前平台</strong><span>权限与系统集成由当前平台提供</span></div><span className="preference-value">{window.snipvia.platform === 'darwin' ? 'macOS' : window.snipvia.platform === 'win32' ? 'Windows' : 'Linux'}</span></div>
      </div>
    </section>

    {status && !configDialog && !predictionDialog && <p className={`preference-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p>}

    {configDialog && <Dialog className="settings-modal provider-config-modal" label="配置厂商" onClose={() => { if (!saving) setConfigDialog(false); }}>
        <div className="modal-header"><div><strong>配置厂商</strong><small>保存后会立即切换到这个配置</small></div><Button type="button" variant="quiet" aria-label="关闭厂商配置" disabled={saving} onClick={() => setConfigDialog(false)}><Icon name="close" size={17} /></Button></div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setStatus(null);
          const result = await window.snipvia.settings.save({
            provider: form.provider,
            endpoint: form.endpoint.trim(),
            model: form.model.trim(),
            shortcut: settings.shortcut,
            continueShortcut: settings.continueShortcut,
            editorShortcut: settings.editorShortcut,
            predictionBranches: settings.predictionBranches,
            apiKey: clearKey ? '' : key.trim() || undefined
          });
          if (result.ok) {
            onSaved(result.value);
            setForm(result.value);
            setKey('');
            setClearKey(false);
            setStatus({ kind: 'success', message: '厂商配置已生效' });
            setConfigDialog(false);
          } else setStatus({ kind: 'error', message: result.error });
          setSaving(false);
        }}>
          <div className="provider-config-scroll"><fieldset disabled={saving} className="provider-config-fields">
            <div className="config-row">
              <label htmlFor="provider-select"><strong>模型厂商</strong><span>{provider.hint}</span></label>
              <Select id="provider-select" aria-label="模型厂商" value={customProvider ? 'custom' : form.provider} onChange={(event) => selectProvider(event.target.value as ProviderId)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            </div>
            {customProvider && <div className="config-row">
              <label htmlFor="provider-endpoint"><strong>API 地址</strong><span>Chat Completions 基础地址，支持 HTTP 和 HTTPS</span></label>
              <Input id="provider-endpoint" aria-label="API 地址" required type="url" value={form.endpoint} onChange={(event) => { setForm({ ...form, provider: 'custom', endpoint: event.target.value }); setKey(''); setClearKey(false); }} placeholder="https://example.com/v1" />
            </div>}
            {endpoints.length > 1 && <div className="config-row">
              <label htmlFor="provider-service"><strong>接口来源</strong><span>与 API Key 的平台和地区匹配；不同接口的密钥独立保存</span></label>
              <Select id="provider-service" aria-label="接口来源" value={namedEndpoint ? form.endpoint.replace(/\/+$/, '') : '__workspace__'} onChange={(event) => {
                const endpoint = event.target.value === '__workspace__' ? '' : event.target.value;
                const saved = settings.configuredModels.find((profile) => profile.provider === form.provider && profile.endpoint.replace(/\/+$/, '') === endpoint);
                const model = saved?.model ?? form.model;
                setForm({ ...form, endpoint, model });
                setKey(''); setClearKey(false); setStatus(null);
              }}>
                {endpoints.map((entry) => <option key={entry.url} value={entry.url}>{entry.name}</option>)}
                {form.provider === 'qwen' && <option value="__workspace__">百炼业务空间专属地址…</option>}
              </Select>
            </div>}
            {!customProvider && <div className="config-row">
              <label htmlFor="provider-official-endpoint"><strong>API 地址</strong><span>{form.provider === 'qwen' && !namedEndpoint ? '填写百炼控制台提供的完整业务空间 Base URL' : '系统自动附加 /chat/completions'}</span></label>
              <Input id="provider-official-endpoint" aria-label="API 地址" required type="url" value={form.endpoint} readOnly={form.provider !== 'qwen' || namedEndpoint}
                onChange={(event) => { setForm({ ...form, endpoint: event.target.value }); setKey(''); setClearKey(false); }} placeholder="https://业务空间ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" />
            </div>}
            <ModelSelectRow scope={{ provider: form.provider, endpoint: form.endpoint }} apiKey={clearKey ? '' : key.trim() || undefined}
              selectedModel={form.model} onSelect={model => { setForm(value => ({ ...value, model })); setStatus(null); }} />
            <div className="config-row">
              <label htmlFor="provider-key"><strong>{provider.name} API Key</strong><span>{hasKey ? '已由系统凭据保护；重新输入可覆盖旧密钥' : form.provider === 'custom' ? '无认证的本地服务可以留空' : '由系统凭据保护'}</span></label>
              <Input id="provider-key" aria-label="API Key" type="password" autoComplete="off" value={key} disabled={clearKey} onChange={(event) => setKey(event.target.value)} placeholder={hasKey ? '留空保持不变' : '输入 API Key'} />
            </div>
            {hasKey && <div className="config-row compact"><div className="preference-copy"><strong>删除 API Key</strong><span>移除当前厂商保存在本机的密钥</span></div><label className="config-checkbox"><input aria-label="删除当前服务的密钥" type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} /><span /></label></div>}
            <p className="notice">{window.snipvia.platform === 'darwin'
              ? 'API Key 使用 macOS 钥匙串保护加密密钥，密文保存在本机设置文件中。首次访问或应用身份变化后可能需要钥匙串授权。'
              : 'API Key 使用 Windows 系统凭据保护（DPAPI）加密，密文保存在本机设置文件中。请使用自己的 Windows 用户账户登录。'}</p>
          </fieldset></div>
          {status?.kind === 'error' && <p className="modal-status" role="alert">{status.message}</p>}
          <div className="modal-footer"><Button type="button" className="secondary" disabled={saving} onClick={() => setConfigDialog(false)}>取消</Button><Button type="submit" variant="primary" className="primary" disabled={saving}>{saving ? '保存中…' : '保存并使用'}</Button></div>
        </form>
    </Dialog>}

    {predictionDialog && <Dialog className="settings-modal prediction-modal" label={predictionTitle} onClose={() => { if (!saving) setPredictionDialog(false); }}>
        <div className="modal-header"><div><strong>{predictionTitle}</strong><small>识别到指定内容后，截然会自动执行这条指令</small></div><Button type="button" variant="quiet" aria-label={`关闭${predictionTitle}`} disabled={saving} onClick={() => setPredictionDialog(false)}><Icon name="close" size={17} /></Button></div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          const label = predictionDraft.label.trim();
          const applicableContent = predictionDraft.applicableContent.trim();
          const prompt = predictionDraft.prompt.trim();
          if (!label || !applicableContent || (promptRequired && !prompt)) return;
          const branch: PredictionBranch = {
            id: editingPrediction?.id ?? `custom:${crypto.randomUUID()}`,
            trigger: editingPrediction?.trigger ?? 'unknown',
            applicableContent,
            label,
            runningLabel: `正在${label}…`,
            prompt,
            enabled: editingPrediction?.enabled ?? true,
            builtin: editingPrediction?.builtin ?? false,
            mode: editingPrediction?.mode ?? 'ai',
            notebookId: predictionDraft.notebookId || null
          };
          const branches = editingPrediction
            ? settings.predictionBranches.map((item) => item.id === branch.id ? branch : item)
            : [...settings.predictionBranches, branch];
          if (await changePredictionBranches(branches, editingPrediction ? '预测分支已更新' : '自定义预测分支已新增')) setPredictionDialog(false);
        }}>
          <fieldset disabled={saving} className="provider-config-fields">
            <div className="config-row">
              <label htmlFor="prediction-label"><strong>分支名称</strong><span>预测完成后显示在对话右上角</span></label>
              <Input id="prediction-label" required maxLength={40} value={predictionDraft.label} onChange={(event) => setPredictionDraft({ ...predictionDraft, label: event.target.value })} placeholder="例如：生成测试用例" />
            </div>
            <div className="config-row prediction-content-row">
              <label htmlFor="prediction-content"><strong>适用内容</strong><span>描述什么样的截图应触发此分支，可注明排除的内容</span></label>
              <textarea id="prediction-content" required maxLength={1000} value={predictionDraft.applicableContent} onChange={(event) => setPredictionDraft({ ...predictionDraft, applicableContent: event.target.value })} placeholder="例如：终端中的编译错误或异常堆栈，不包括网页中的错误提示。" />
            </div>
            <div className="config-row">
              <label htmlFor="prediction-notebook"><strong>绑定笔记本</strong><span>命中此分支时自动选择；可不绑定，也可在对话中更换</span></label>
              <Select id="prediction-notebook" value={predictionDraft.notebookId} onChange={(event) => setPredictionDraft({ ...predictionDraft, notebookId: event.target.value })}>
                <option value="">不绑定笔记本</option>
                {predictionDraft.notebookId && !notebooks.some((book) => book.id === predictionDraft.notebookId) && <option value={predictionDraft.notebookId}>原笔记本不可用，请重新选择</option>}
                {notebooks.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
              </Select>
            </div>
            {!notebooks.length && <p className="notes-binding-hint">还没有笔记本，可先在「AI 笔记」中创建。</p>}
            <div className="config-row prediction-prompt-row">
              <label htmlFor="prediction-prompt"><strong>执行指令</strong><span>{editingPrediction?.mode === 'schedule' ? '填写日程提取的补充要求，可留空；结果仍保存为待确认的草稿' : '告诉模型收到这类截图后应该完成什么'}</span></label>
              <textarea id="prediction-prompt" required={promptRequired} maxLength={4000} value={predictionDraft.prompt} onChange={(event) => setPredictionDraft({ ...predictionDraft, prompt: event.target.value })} placeholder={editingPrediction?.mode === 'schedule' ? '例如：只提取会议，把参会人补充到备注中。' : '例如：根据截图中的代码生成必要的单元测试，并说明覆盖场景。'} />
            </div>
          </fieldset>
          {status?.kind === 'error' && <p className="modal-status" role="alert">{status.message}</p>}
          <div className="modal-footer">{editingPrediction && onDiscuss && <Button disabled={saving} title="仅携带已保存的分支；不会自动保存当前表单" onClick={() => { setPredictionDialog(false); void onDiscuss({ kind: 'branches', branchIds: [editingPrediction.id] }); }}>用 AI 编辑已保存分支</Button>}<Button type="button" className="secondary" disabled={saving} onClick={() => setPredictionDialog(false)}>取消</Button><Button type="submit" variant="primary" className="primary" disabled={saving || !predictionDraft.label.trim() || !predictionDraft.applicableContent.trim() || (promptRequired && !predictionDraft.prompt.trim())}>{saving ? '保存中…' : editingPrediction ? '保存修改' : '新增分支'}</Button></div>
        </form>
    </Dialog>}

    {privacyDialog && <Dialog className="privacy-modal" label="截图隐私说明" onClose={() => setPrivacyDialog(false)}>
        <div className="modal-header"><div className="privacy-modal-title"><Icon name="info" size={21} /><strong>你的截图，由你决定</strong></div><Button type="button" variant="quiet" aria-label="关闭隐私说明" onClick={() => setPrivacyDialog(false)}><Icon name="close" size={17} /></Button></div>
        <p>框选过程和全屏帧不会上传。完成选区后，截然会先尝试本机文字识别；需要分类或执行自动操作时，所选图片会发送到你配置的模型服务。手动提问还会发送问题和最近 6 轮对话。截图与对话历史保存在本机，可在「历史对话」中单项删除或全部清空。</p>
    </Dialog>}
  </section>;
}
