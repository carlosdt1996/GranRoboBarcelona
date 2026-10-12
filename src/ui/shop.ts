import { PRICES } from '../game/economy';
import type { Economy } from '../game/economy';
import { weaponIcon } from './wheel';

/** Armería: lista de armas y chaleco con su precio. Se compra con clic o con las teclas 1-5. */
export class ShopMenu {
  open = false;
  onBuy?: (id: (typeof PRICES)[number]['id']) => void;
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  private title: HTMLDivElement;

  constructor(private eco: Economy) {
    this.root = document.createElement('div');
    this.root.id = 'shop';
    this.root.hidden = true;
    this.root.innerHTML = `<div class="pm"><div class="pm-title"></div><div class="sh-list"></div><div class="pm-help">1-5: COMPRAR · ESC O F: SALIR</div></div>`;
    document.body.appendChild(this.root);
    this.title = this.root.querySelector('.pm-title')!;
    this.list = this.root.querySelector('.sh-list')!;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  show(name: string) {
    this.open = true;
    this.root.hidden = false;
    this.title.textContent = name;
    this.render();
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  buy(i: number) {
    const it = PRICES[i];
    if (!it) return;
    if (it.id !== 'armor' && this.eco.owned.has(it.id)) return;
    if (!this.eco.spend(it.price)) return;
    this.onBuy?.(it.id);
    this.render();
  }

  private render() {
    this.list.replaceChildren(...PRICES.map((it, i) => {
      const b = document.createElement('button');
      const owned = it.id !== 'armor' && this.eco.owned.has(it.id);
      b.className = owned ? 'owned' : this.eco.money < it.price ? 'poor' : '';
      if (it.id !== 'armor') b.appendChild(weaponIcon(it.id));
      const t = document.createElement('span');
      t.textContent = `${i + 1}. ${it.name} · ${owned ? 'YA LA TIENES' : `$${it.price}`}`;
      b.appendChild(t);
      b.addEventListener('click', () => this.buy(i));
      return b;
    }));
  }
}
