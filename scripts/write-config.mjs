// Usado pelo GitHub Actions: grava a URL e a chave pública do Supabase no app.
import { writeFileSync } from 'node:fs';
const url = (process.env.SUPABASE_URL || '').trim(), key = (process.env.SUPABASE_ANON_KEY || '').trim();
writeFileSync('app/js/config.js', `// Gerado automaticamente pelo GitHub Actions.\nwindow.AGENDA_CONFIG = ${JSON.stringify({ url, key })};\n`);
console.log(url ? `Supabase configurado: ${url}` : 'Sem SUPABASE_URL: o app vai pedir os dados em Configurações.');
