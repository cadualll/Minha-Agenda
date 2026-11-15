// Ajusta o projeto Android gerado pelo Capacitor: permissões, Firebase e ícones.
import { readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
const manifest = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifest)) { console.error('Rode "npx cap add android" antes.'); process.exit(1); }
let xml = readFileSync(manifest, 'utf8');
const perms = [
  'android.permission.POST_NOTIFICATIONS',     // Android 13+: mostrar notificações
  'android.permission.SCHEDULE_EXACT_ALARM',   // Android 12: alarmes no horário exato
  'android.permission.USE_EXACT_ALARM',        // Android 13+: alarmes exatos (app de agenda)
  'android.permission.RECEIVE_BOOT_COMPLETED', // reagendar depois de reiniciar o celular
  'android.permission.WAKE_LOCK',
  'android.permission.INTERNET'
];
for (const p of perms) if (!xml.includes(`"${p}"`)) xml = xml.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${p}" />\n</manifest>\n`);
// Avisos do Firebase: ícone, cor e canal padrão (iguais aos alarmes locais)
const meta = [
  '<meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_agenda" />',
  '<meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/agenda_accent" />',
  '<meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="lembretes" />'
];
for (const m of meta) if (!xml.includes(m.match(/name="([^"]+)"/)[1])) xml = xml.replace(/<\/application>/, `    ${m}\n    </application>`);
writeFileSync(manifest, xml);
cpSync('scripts/android-res', 'android/app/src/main/res', { recursive: true, force: true });
console.log('Android ajustado: permissões, Firebase e ícones.');
