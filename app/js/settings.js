// Tela de configurações: sincronização, notificações, feriados e backup.
import { $, esc, icon, openModal, closeModal, toast, confirmBox } from './ui.js';
import { permissionStatus, requestPermission, testNotification, isNative, serverPushActive, initNativePush } from './notify.js';
import { pushStatus, enablePush, disablePush, testServerPush, pushSupported } from './push.js';
import { REMINDER_OPTIONS } from './tasks.js';

export async function openSettings(ctx) {
  const { store } = ctx;
  const s = store.settings();
  const cfg = store.config;
  const user = store.supa.user;
  const perm = await permissionStatus().catch(() => ({ display: 'unsupported' }));
  const ps = isNative() ? { supported: false } : await pushStatus().catch(() => ({ supported: false }));
  const st = store.status;
  const statusTxt = !store.online ? 'Modo local (somente neste aparelho)' : st.state === 'synced' ? `Sincronizado ${st.lastSync ? 'às ' + new Date(st.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}` : st.state === 'offline' ? 'Sem internet — as alterações sobem quando voltar' : st.state === 'error' ? `Erro: ${st.error}` : 'Sincronizando…';
  const m = openModal(`
    <div class="settings">
      <div class="ed-head"><h2>Configurações</h2><button class="icon-btn" data-a="close">${icon('x')}</button></div>
      <div class="ed-body">
        <section class="card">
          <h3>${icon('cloud')} Sincronização entre celular e computador</h3>
          <p class="status-line ${store.online ? 'ok' : ''}">${esc(statusTxt)}</p>
          ${user ? `
            <p>Conectado como <b>${esc(user.email)}</b></p>
            <div class="row gap wrap"><button class="btn primary" data-a="sync">${icon('refresh')} Sincronizar agora</button><button class="btn ghost" data-a="logout">Sair desta conta</button></div>` : `
            <form id="login-form" class="stack">
              <details ${cfg.url ? '' : 'open'}><summary>Dados do projeto Supabase ${cfg.url ? '(já preenchidos)' : ''}</summary>
                <label class="field"><span>URL do projeto</span><input class="input" name="url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url)}" required></label>
                <label class="field"><span>Chave pública (anon / publishable)</span><input class="input" name="key" placeholder="eyJhbGciOi... ou sb_publishable_..." value="${esc(cfg.key)}" required></label>
              </details>
              <label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="username" required></label>
              <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
              <button class="btn primary">Entrar e sincronizar</button>
              <small class="muted">As tarefas que já estão neste aparelho são enviadas para a nuvem ao entrar — nada se perde.</small>
            </form>`}
        </section>

        <section class="card">
          <h3>${icon('bell')} Avisos (notificações)</h3>
          ${isNative() ? `
          <p class="status-line ${perm.display === 'granted' ? 'ok' : ''}">Notificações: ${perm.display === 'granted' ? 'permitidas' : 'ainda não permitidas'} • alarmes exatos: ${perm.exact === 'granted' ? 'ok' : 'desligados'}</p>
          <p class="status-line ${serverPushActive() ? 'ok' : ''}">${serverPushActive() ? '✓ Avisos pelo servidor ativos: o que você criar no PC também toca aqui' : store.online ? 'Avisos pelo servidor inativos (confira o Firebase e a função “lembretes” no guia). Por enquanto, só alarmes deste celular.' : 'Entre na sua conta para receber avisos das tarefas criadas no PC.'}</p>
          <div class="row gap wrap"><button class="btn primary" data-a="perm">Permitir notificações</button>${store.online ? '<button class="btn ghost" data-a="push-test">Testar pelo servidor</button><button class="btn ghost" data-a="native-retry">Reconectar avisos</button>' : ''}<button class="btn ghost" data-a="test">Teste local</button></div>
          <p class="tip">Para os avisos chegarem na hora com a tela apagada: <b>Configurações do Android → Apps → Minha Agenda IA → Bateria → Sem restrições</b> (Samsung: “Não otimizado”; Xiaomi: “Sem restrições” + “Início automático”).</p>` : !ps.supported ? `
          <p class="status-line">Este navegador não recebe avisos com o app fechado. No Android use o Chrome; no iPhone, adicione a agenda à Tela de Início e abra por lá.</p>` : `
          <p class="status-line ${ps.subscribed && ps.permission === 'granted' ? 'ok' : ''}">${ps.permission === 'denied' ? 'Notificações bloqueadas — libere nas configurações do navegador' : ps.subscribed ? '✓ Este aparelho recebe avisos mesmo com a agenda fechada' : 'Este aparelho ainda não recebe avisos'}</p>
          <div class="row gap wrap">
            ${ps.subscribed ? `<button class="btn primary" data-a="push-test">Testar agora</button><button class="btn ghost" data-a="push-off">Desativar neste aparelho</button>`
              : `<button class="btn primary" data-a="push-on" ${store.online ? '' : 'disabled'}>Ativar avisos neste aparelho</button>`}
          </div>
          ${store.online ? '' : '<small class="muted">Entre na sua conta (acima) para ativar.</small>'}
          <p class="tip">Os avisos são enviados pelo seu Supabase a cada minuto, para todos os aparelhos ativados (celular e PC). Ative em cada aparelho. No Android, deixe o <b>Chrome</b> sem restrição de bateria: <b>Configurações → Apps → Chrome → Bateria → Sem restrições</b>.</p>`}
          <label class="field"><span>Horário do aviso de tarefas “dia inteiro”</span><input class="input" type="time" name="allDayTime" value="${esc(s.allDayTime || '09:00')}"></label>
          <label class="field"><span>Lembrete padrão para tarefas com horário</span><select class="input" name="defRem">${REMINDER_OPTIONS.map(o => `<option value="${o.v}" ${((s.defaultReminders || [0])[0]) === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}<option value="-1" ${(s.defaultReminders || [0]).length === 0 ? 'selected' : ''}>Nenhum</option></select></label>
        </section>

        <section class="card">
          <h3>${icon('calendar')} Feriados (para “dia útil”)</h3>
          <p class="muted">Feriados nacionais já incluídos, inclusive Sexta-feira Santa e Consciência Negra (20/11).</p>
          <label class="check-line"><input type="checkbox" name="carnaval" ${s.holidays?.carnaval === false ? '' : 'checked'}> Considerar Carnaval (segunda e terça) como não útil</label>
          <label class="check-line"><input type="checkbox" name="corpus" ${s.holidays?.corpusChristi === false ? '' : 'checked'}> Considerar Corpus Christi como não útil</label>
          <label class="field"><span>Feriados estaduais/municipais (um por linha: DD/MM Nome, ou AAAA-MM-DD Nome)</span>
            <textarea class="input" name="extra" rows="3" placeholder="25/01 Aniversário de São Paulo&#10;09/07 Revolução Constitucionalista">${esc((s.holidays?.extra || []).map(h => `${h.date} ${h.name || ''}`.trim()).join('\n'))}</textarea></label>
        </section>

        <section class="card">
          <h3>${icon('download')} Backup</h3>
          <p class="muted">Baixe uma cópia de tudo (tarefas, listas e configurações). Também importa backups da versão anterior.</p>
          <div class="row gap wrap"><button class="btn ghost" data-a="export">${icon('download')} Baixar backup</button><button class="btn ghost" data-a="import">${icon('upload')} Importar backup</button><input type="file" id="imp-file" accept=".json,application/json" hidden></div>
        </section>
        <p class="muted center">Minha Agenda IA • versão 2.0</p>
      </div>
      <div class="ed-foot"><span class="grow"></span><button class="btn primary" data-a="save">Salvar preferências</button></div>
    </div>`, { cls: 'settings-modal' });

  const form = $('#login-form', m);
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      store.setConfig(form.url.value, form.key.value);
      await store.login(form.email.value.trim(), form.password.value);
      toast('Conectado! Suas tarefas estão sincronizadas.');
      closeModal(); ctx.afterLogin();
      if (!isNative() && pushSupported() && Notification.permission !== 'denied' && await confirmBox('Ativar os avisos neste aparelho? Eles chegam mesmo com a agenda fechada.', { ok: 'Ativar avisos' })) {
        try { await enablePush(store); toast('Avisos ativados neste aparelho!'); } catch (err) { toast(err.message, { ms: 9000 }); }
      }
    } catch (err) { toast(err.message, { ms: 7000 }); btn.disabled = false; btn.textContent = 'Entrar e sincronizar'; }
  });

  m.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'close') closeModal();
    if (act === 'sync') { try { const r = await store.sync(); toast(`Sincronizado (${r.pushed || 0} enviados, ${r.pulled || 0} recebidos).`); closeModal(); } catch (err) { toast(err.message); } }
    if (act === 'logout') {
      const wipe = await confirmBox('Sair da conta. Deseja também apagar as tarefas DESTE aparelho? (Elas continuam na nuvem.)', { ok: 'Sair e limpar aparelho', danger: true });
      await store.logout({ wipe }); closeModal(); ctx.render(); toast('Você saiu da conta.');
    }
    if (act === 'perm') { const r = await requestPermission(); toast(r === 'granted' ? 'Notificações permitidas.' : 'Permissão não concedida.'); ctx.reschedule(); closeModal(); }
    if (act === 'test') { try { toast(await testNotification()); } catch (err) { toast(err.message); } }
    if (act === 'push-on') { a.disabled = true; a.textContent = 'Ativando…'; try { await enablePush(store); closeModal(); toast('Avisos ativados neste aparelho! Toque em “Testar agora” para conferir.'); openSettings(ctx); } catch (err) { toast(err.message, { ms: 9000 }); a.disabled = false; a.textContent = 'Ativar avisos neste aparelho'; } }
    if (act === 'push-test') { a.disabled = true; try { const r = await testServerPush(store); toast(r.enviados ? `Aviso de teste enviado para ${r.enviados} aparelho(s). Deve chegar em segundos.` : 'Nenhum aparelho ativado recebeu. Desative e ative de novo.', { ms: 7000 }); } catch (err) { toast(err.message, { ms: 7000 }); } a.disabled = false; }
    if (act === 'native-retry') { await initNativePush(store, () => {}); toast('Registrando este celular no servidor… confira o status em alguns segundos.'); closeModal(); }
    if (act === 'push-off') { await disablePush(store); closeModal(); toast('Avisos desativados neste aparelho.'); }
    if (act === 'export') ctx.exportBackup();
    if (act === 'import') $('#imp-file', m).click();
    if (act === 'save') {
      const extra = m.querySelector('[name=extra]').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const mm = l.match(/^(\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\s*(.*)$/); return mm ? { date: mm[1], name: mm[2] || 'Feriado local' } : null;
      }).filter(Boolean);
      const defRem = Number(m.querySelector('[name=defRem]').value);
      store.saveSettings({
        allDayTime: m.querySelector('[name=allDayTime]').value || '09:00',
        defaultReminders: defRem < 0 ? [] : [defRem],
        defaultAllDayReminders: [0],
        holidays: { carnaval: m.querySelector('[name=carnaval]').checked, corpusChristi: m.querySelector('[name=corpus]').checked, extra }
      });
      toast('Preferências salvas.'); closeModal();
    }
  });
  $('#imp-file', m).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const n = store.importJSON(JSON.parse(await file.text())); toast(`${n} tarefa(s) importada(s).`); closeModal(); }
    catch (err) { toast('Erro ao importar: ' + err.message); }
  });
}
