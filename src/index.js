import 'dotenv/config';
// original direct startup retained below for reference.
// import app from './app.js';
import { startServer } from './server.js';

const PORT = process.env.PORT || 3000;

// app.listen(PORT, () => {
//   console.log(`Server running at http://localhost:${PORT}`);
// });

try {
  await startServer(PORT);
} catch {
  // Do not log Redis URLs, credentials, or raw error causes.
  console.error('Server startup failed. Check Redis settings, connectivity, and the HTTP port.');
  process.exitCode = 1;
}
