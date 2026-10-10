# Scarcity mindset experiment

Persian cognitive tasks for a school study, with a local SQLite database.

## Run

1. Install [Node.js 22](https://nodejs.org/) and run `npm install`.
2. Copy `.env.example` to `.env` and set `RESEARCHER_PASSWORD`.
3. Copy `stimuli/manifest.example.json` to `stimuli/manifest.json` and fill it before a real session. A session will not start while that file is incomplete. It needs:
   - 20 main products and 3 practice products, each with a Persian name and a 300×300 PNG
   - 8 new recognition words that are not in the stage-1 list
   - either 8 fixed old words from the stage-1 list, or `"recognitionOld": { "mode": "randomPerSession" }`
   - the baseline-day stages, for example `["spatial", "recognition", "emotion", "switch"]`
4. Run `npm run dev`.
5. Open `http://localhost:3000/admin` on the researcher laptop. Student laptops on the same network open `http://<this-computer>:3000` and enter the participant id.

The database file is `data/experiment.sqlite`.

## Analysis

```bash
pip install -r analysis/requirements.txt
python analysis/did.py
python analysis/did.py --self-test
```

The script writes `analysis/output/did-report.json`. It does not replace raw trial rows. Mediation is not estimated.
