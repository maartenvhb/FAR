# FAR Analysis Tool

A browser-based research implementation of **Field Anomaly Relaxation (FAR)** — a systematic method for exploring alternative futures. This is a foresight methodology developed by Russell Rhyne.

## Running it

Open `index.html` in any modern browser.

```
git clone https://github.com/maartenvhb/FAR.git
cd FAR
open index.html      # macOS
# or just double-click index.html in your file manager
```

The whole tool runs client-side as static HTML/CSS/JS. You can access a web based version from https://www.daemon.be/maarten/FAR/ (with some of the AI integrations disabled).

## AI Analyst (optional)

The tool can use an LLM to assist with brainstorming, CCM pre-scoring, warning indicators, and narrative drafting. Three providers are supported:

- **[Ollama](https://ollama.com)** — runs locally on your machine; no API key needed.
- **[Claude API](https://console.anthropic.com/)** — requires an Anthropic API key.
- **[Gemini API](https://aistudio.google.com/apikey)** — requires a Google AI Studio API key.

API keys are stored in your browser's `localStorage` and are sent to the respective provider's API. Any script running on this origin can read them, so don't paste keys into a copy of this tool you don't trust.

## Contact

For any questions, contact maarten.vhb@gmail.com

## License

[MIT](LICENSE)
