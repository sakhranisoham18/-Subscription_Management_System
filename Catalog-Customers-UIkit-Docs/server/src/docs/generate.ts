/** Regenerates docs/openapi.json and the Postman collection:  npm run docs:generate --workspace server */
import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApi, buildPostman } from './openapi';

const out = path.resolve(__dirname, '../../../docs');
fs.writeFileSync(path.join(out, 'openapi.json'), JSON.stringify(buildOpenApi(), null, 2));
fs.writeFileSync(path.join(out, 'Brightloop-Subscription-Management.postman_collection.json'), JSON.stringify(buildPostman(), null, 2));
console.log('Wrote docs/openapi.json and the Postman collection');
