import './styles.css';
import { Game } from './core/Game';

const container = document.getElementById('app');
if (!container) throw new Error('#app não encontrado');

new Game(container).start().catch((err: unknown) => {
  console.error(err);
  container.innerHTML = `<pre class="fatal">Falha ao iniciar o jogo:\n${String(err)}</pre>`;
});
