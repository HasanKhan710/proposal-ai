
import { createClient } from '@libsql/client';

const db = createClient({
  url: 'file:proposal-ai.sqlite',
});

async function main() {
  const result = await db.execute("SELECT id, name, file_path FROM documents WHERE name LIKE '%WAPOL%'");
  console.log(JSON.stringify(result.rows, null, 2));
}

main().catch(console.error);
