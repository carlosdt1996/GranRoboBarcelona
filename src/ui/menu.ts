/** Opciones del jugador (se guardan en el navegador). */
export interface Options {
  /** Círculo de apuntado sobre el blanco fijado. */
  reticle: boolean;
  /** Apuntado automático al disparar sin apuntar. */
  autoAim: boolean;
  music: boolean;
}

const KEY = 'gran-robo-barcelona.options';
const DEFAULTS: Options = { reticle: true, autoAim: true, music: true };

export function loadOptions(): Options {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveOptions(o: Options) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* sin almacenamiento: solo esta sesión */ }
}

const LABELS: Record<keyof Options, string> = {
  reticle: 'CÍRCULO DE APUNTADO',
  autoAim: 'AUTOAPUNTADO AL DISPARAR',
  music: 'MÚSICA',
};

/** Menú de pausa (Esc): continuar, opciones, guardar y estadísticas. */
export class PauseMenu {
  open = false;
  onChange?: (o: Options) => void;
  onSave?: () => void;
  /** Acciones que en el teclado tienen tecla propia: 'heli' (H), 'radio' (V), 'music' (N). */
  onAction?: (a: 'heli' | 'radio') => void;
  private root: HTMLDivElement;
  private optsEl: HTMLDivElement;
  private statsEl: HTMLDivElement;

  constructor(readonly options: Options, private stats: () => [string, string][]) {
    this.root = document.createElement('div');
    this.root.id = 'pause';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="pm">
        <div class="pm-title">PAUSA</div>
        <button data-act="resume">CONTINUAR</button>
        <button data-act="save">GUARDAR PARTIDA</button>
        <button data-act="heli">PEDIR HELICÓPTERO (H)</button>
        <button data-act="radio">CAMBIAR DE EMISORA (V)</button>
        <div class="pm-sub">OPCIONES</div>
        <div class="pm-opts"></div>
        <div class="pm-sub">ESTADÍSTICAS</div>
        <div class="pm-stats"></div>
        <div class="pm-help">ESC: VOLVER AL JUEGO</div>
      </div>`;
    document.body.appendChild(this.root);
    this.optsEl = this.root.querySelector('.pm-opts')!;
    this.statsEl = this.root.querySelector('.pm-stats')!;
    this.root.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.toggle());
    this.root.querySelector('[data-act="save"]')!.addEventListener('click', () => this.onSave?.());
    this.root.querySelector('[data-act="heli"]')!.addEventListener('click', () => { this.toggle(); this.onAction?.('heli'); });
    this.root.querySelector('[data-act="radio"]')!.addEventListener('click', () => { this.toggle(); this.onAction?.('radio'); });
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.renderOptions();
  }

  private renderOptions() {
    this.optsEl.replaceChildren(...(Object.keys(LABELS) as (keyof Options)[]).map((k) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = `${LABELS[k]}: ${this.options[k] ? 'SÍ' : 'NO'}`;
      b.addEventListener('click', () => {
        this.options[k] = !this.options[k];
        saveOptions(this.options);
        this.renderOptions();
        this.onChange?.(this.options);
      });
      return b;
    }));
  }

  /** Cambiar una opción desde fuera (p. ej. la tecla N de la música). */
  set(k: keyof Options, v: boolean) {
    this.options[k] = v;
    saveOptions(this.options);
    this.renderOptions();
  }

  toggle() {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) {
      this.statsEl.replaceChildren(...this.stats().map(([k, v]) => {
        const r = document.createElement('div');
        r.innerHTML = `<span></span><b></b>`;
        r.firstElementChild!.textContent = k;
        r.lastElementChild!.textContent = v;
        return r;
      }));
    }
  }
}
