// PM2 process definition for the Reactive Resume production server.
//
//   pm2 start ecosystem.config.cjs     # start (run from this directory)
//   pm2 restart reactive-resume        # after `pnpm build` to pick up changes
//   pm2 logs reactive-resume
//
// serve-prod.sh relinks the externalized deps (bcrypt/sharp/linkedom/...) into
// the Nitro output then exec's the server, so PM2 tracks the node process and
// restarts survive a rebuild. PORT/DATABASE_URL are set here; APP_URL and
// secrets come from the repo .env.
const path = require("node:path");

module.exports = {
	apps: [
		{
			name: "reactive-resume",
			cwd: __dirname,
			script: path.join(__dirname, "scripts/serve-prod.sh"),
			interpreter: "/bin/bash",
			env: {
				PORT: "3002",
				DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
				NODE_ENV: "production",
			},
			autorestart: true,
			restart_delay: 5000,
			max_restarts: 50,
			out_file: path.join(process.env.HOME || "", "Library/Logs/reactive-resume.out.log"),
			error_file: path.join(process.env.HOME || "", "Library/Logs/reactive-resume.err.log"),
		},
	],
};
