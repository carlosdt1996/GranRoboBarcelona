import type { ModelKind } from '../../render/cars';

/** [lon, lat] */
export type Pt = [number, number];
/** [quién habla (id de personaje), texto] */
export type Line = [string, string];

export type Step =
  | { t: 'goto'; at: Pt; text: string; r?: number; heli?: boolean; roof?: boolean; car?: boolean }
  | { t: 'steal'; at: Pt; kind: ModelKind; color: string; text: string }
  | { t: 'deliver'; at: Pt; text: string }
  | { t: 'destroy'; at: Pt; kind: ModelKind; color: string; text: string; count?: number }
  | { t: 'kill'; at: Pt; who: string[]; guards?: number; text: string }
  | { t: 'pickup'; at: Pt; text: string; stars?: number }
  | { t: 'escape'; stars: number; text: string }
  | { t: 'escort'; who: string; at: Pt; text: string }
  | { t: 'race'; pts: Pt[]; text: string; time: number }
  | { t: 'collect'; who: string[]; text: string }
  | { t: 'talk'; lines: Line[] };

export interface Mission {
  id: string;
  act: string;
  title: string;
  giver: string;
  /** Interior donde se encarga la misión. */
  room: 'piso' | 'bar' | 'nave' | 'mansion' | 'taller' | 'oficina';
  intro: Line[];
  steps: Step[];
  outro: Line[];
  reward: number;
  /** Límite de tiempo para toda la misión (s). */
  time?: number;
}

/**
 * La historia de Pau Rovira, «l'Egarenc»: un chaval de Terrassa que baja a Barcelona por una deuda
 * de su prima y acaba metido hasta el cuello en los negocios de media ciudad. Parodia exagerada con humor
 * negro, al estilo GTA: todo es ficción.
 */
export const MISSIONS: Mission[] = [
  // ======================================================================= ACTO I · TERRASSA
  {
    id: 'egara', act: 'ACTO I · TERRASSA', title: 'DE VUELTA A EGARA', giver: 'tete', room: 'piso',
    intro: [
      ['tete', 'Pau. Cuánto tiempo. Siéntate. No, ahí no, que el sofá tiene una mancha de algo que no quiero explicar.'],
      ['pau', '¿Qué has hecho esta vez, Tete?'],
      ['tete', 'Invertí en criptomonedas. Luego en un bar. Luego en un bar de criptomonedas. Debo veinte mil euros a gente del Raval.'],
      ['pau', '¿Y por qué me lo cuentas a mí?'],
      ['tete', 'Porque les di tu nombre como aval. Y tu DNI. Y la dirección de la iaia, que en paz descanse.'],
      ['karim', 'Pau, primo. Tranquilo: en Terrassa nadie muere por deudas. Se muere por la C-16.'],
      ['tete', 'El Nando tiene un coche para ti en el desguace de Can Parellada. Empezamos hoy.'],
    ],
    steps: [
      { t: 'goto', at: [1.9915, 41.5590], text: 'Ve al desguace del Nando en Can Parellada.' },
      { t: 'talk', lines: [['nando', 'Ese Seat lleva tres matrículas y dos dueños muertos. El tercero, si quieres, eres tú.'], ['pau', 'Me quedo la matrícula que no tenga multas.'], ['nando', 'Entonces ninguna. Y no abras el maletero, que el último dueño sigue dentro.']] },
      { t: 'steal', at: [1.9925, 41.5585], kind: 'sedan', color: '#f2f2f2', text: 'Sube al coche blanco del desguace.' },
      { t: 'deliver', at: [2.0068, 41.5628], text: 'Vuelve a la Rambleta del Pare Alegre.' },
    ],
    outro: [['tete', 'Perfecto. Ya tienes coche. Mañana bajas a Barcelona. Si no vuelves, ¿me dejas el piso?']],
    reward: 500,
  },
  {
    id: 'c16', act: 'ACTO I · TERRASSA', title: 'LA C-16', giver: 'tete', room: 'piso',
    intro: [
      ['tete', 'La Reina del Raval quiere conocerte. Llévale este sobre. Y no lo abras.'],
      ['pau', '¿Y si lo abro?'],
      ['tete', 'Entonces dentro encontrarás una foto tuya con una cruz encima. Es un sistema muy antiguo, pero funciona.'],
    ],
    steps: [
      { t: 'pickup', at: [2.0098, 41.5640], text: 'Recoge el sobre del Avi Quim en la Plaça Vella.' },
      { t: 'talk', lines: [['avi-quim', 'Nen, en mi época estas cosas se hacían en mano y con un apretón. Del cuello.'], ['pau', 'Ahora se hace igual, avi. Pero con Bizum.'], ['avi-quim', 'Y si te para la Guardia Civil en la C-16, tú di que vas a Montserrat a rezar. Siempre cuela.']] },
      { t: 'goto', at: [2.1688, 41.3790], text: 'Baja a Barcelona: el Bar La Sirena, en el Raval.', car: true },
    ],
    outro: [['pakito', 'Así que tú eres el de Terrassa. Bienvenido a Barcelona: aquí el alquiler te mata antes que las balas.']],
    reward: 800,
    time: 900,
  },
  // ======================================================================= ACTO II · EL RAVAL
  {
    id: 'raval', act: 'ACTO II · EL RAVAL', title: 'BIENVENIDO AL RAVAL', giver: 'remei', room: 'bar',
    intro: [
      ['remei', 'Tu prima me debe veinte mil. Podría venderte por piezas, pero el mercado de riñones está saturado de guiris.'],
      ['pau', 'Muy amable, señora.'],
      ['remei', 'En el Moll de la Fusta hay un deportivo amarillo de un ruso. Lo quiero en un garaje del Poblenou. Sin rayones.'],
      ['hassan', 'Y si te pillan, no conoces a la Remei. Ni a mí. Ni a tu madre.'],
    ],
    steps: [
      { t: 'steal', at: [2.1810, 41.3778], kind: 'player', color: '#f4d020', text: 'Roba el deportivo amarillo del Moll de la Fusta.' },
      { t: 'deliver', at: [2.2000, 41.4000], text: 'Llévalo al garaje del Poblenou sin un rasguño.' },
    ],
    outro: [['remei', 'Buen trabajo, egarense. Quedan diecinueve mil. Y los intereses: un dedo por semana de retraso.']],
    reward: 1000,
  },
  {
    id: 'boqueria', act: 'ACTO II · EL RAVAL', title: 'COBROS EN LA BOQUERIA', giver: 'remei', room: 'bar',
    intro: [
      ['remei', 'Tres paradistas de la Boqueria llevan tres meses sin pagarme la «tasa de limpieza».'],
      ['pau', '¿Limpieza de qué?'],
      ['remei', 'De sangre, cariño. Cobra. Con educación, si puede ser. Y si no puede ser, con el bate, que también es educativo.'],
    ],
    steps: [
      { t: 'collect', who: ['boqueria', 'pescater', 'fruiter'], text: 'Cobra a los tres paradistas de la Boqueria.' },
      { t: 'escape', stars: 1, text: 'Algún vecino ha llamado a la Urbana. Despístalos.' },
    ],
    outro: [['remei', '¿Ves? Con educación se consigue todo. El pescadero ha llorado, pero eso es buena señal: tiene alma.']],
    reward: 1500,
  },
  {
    id: 'manters', act: 'ACTO II · EL RAVAL', title: 'MANTEROS Y MADEROS', giver: 'remei', room: 'bar',
    intro: [
      ['remei', 'El Manos, el carterista de la Catedral, me ha robado una bolsa. A mí. En mi barrio. Es casi tierno.'],
      ['pau', '¿Le quito la bolsa o la cartera?'],
      ['remei', 'La bolsa, la cartera y las ganas de vivir. Luego llévala a la Barceloneta, al Vadó.'],
    ],
    steps: [
      { t: 'kill', at: [2.1763, 41.3840], who: ['carterista'], text: 'Encuentra al Manos en la Catedral y quítale la bolsa.' },
      { t: 'pickup', at: [2.1763, 41.3842], text: 'Coge la bolsa.', stars: 2 },
      { t: 'goto', at: [2.1895, 41.3795], text: 'Llévala al Vadó, en la Barceloneta.' },
    ],
    outro: [['pescador', 'Ya lo decía yo: el de Terrassa es de fiar. Para ser de Terrassa. Para ser persona, ya veremos.']],
    reward: 2000,
  },
  // ======================================================================= ACTO III · POBLENOU
  {
    id: 'diagonal', act: 'ACTO III · POBLENOU', title: 'PERSECUCIÓN EN LA DIAGONAL', giver: 'biel', room: 'nave',
    intro: [
      ['biel', 'Bro, la Remei me ha hablado de ti. Eres muy... analógico. Me encanta. Muy vintage.'],
      ['pau', '¿Qué quieres?'],
      ['biel', 'Un tal Quique Llopis ha compartido nuestro modelo de negocio con los Mossos. Sin NDA, bro. Sin NDA.'],
      ['biel', 'Haz un rebranding de su coche. Con fuego. El fuego es muy de Poblenou.'],
    ],
    steps: [
      { t: 'destroy', at: [2.1420, 41.3920], kind: 'sedan', color: '#8a8a8a', text: 'Destruye el coche gris del Soplón antes de que llegue a la comisaría.' },
    ],
    outro: [['biel', 'Disrupción total. Lo subo a LinkedIn: «Hoy hemos optimizado un problema de comunicación externa». Dos mil likes.']],
    reward: 2500,
    time: 180,
  },
  {
    id: 'patinets', act: 'ACTO III · POBLENOU', title: 'SUPERILLA', giver: 'biel', room: 'nave',
    intro: [
      ['biel', 'Lanzamos un servicio de entregas en diez minutos. Si tardas once, el cliente se muere. Literalmente: es insulina.'],
      ['pau', '¿Es broma?'],
      ['biel', 'Bro, no. Bueno, la mitad de las cajas es insulina. La otra mitad, mejor no preguntes.'],
    ],
    steps: [
      { t: 'race', pts: [[2.2005, 41.4000], [2.1960, 41.4060], [2.1890, 41.4030], [2.1950, 41.3960], [2.2060, 41.3990], [2.1990, 41.4030]], text: 'Pasa por todos los puntos de entrega del Poblenou.', time: 150 },
    ],
    outro: [['rider', 'Tío, ni yo con la bici trucada a cincuenta por hora. Y eso que el algoritmo me persigue.']],
    reward: 2000,
  },
  {
    id: 'portolimpic', act: 'ACTO III · POBLENOU', title: 'FIESTA EN EL PORT OLÍMPIC', giver: 'biel', room: 'nave',
    intro: [
      ['biel', 'DJ Lux pincha esta noche en el Port Olímpic, pero el Armario no la deja entrar porque le debe dinero.'],
      ['johnny', 'El Armario no deja entrar ni a su madre. Literalmente: su madre está fuera desde 2019.'],
      ['biel', 'Que el Armario deje de ser un problema. Y que Lux llegue a la cabina. El techno no espera.'],
    ],
    steps: [
      { t: 'escort', who: 'dj', at: [2.1985, 41.3868], text: 'Recoge a DJ Lux y llévala al Port Olímpic.' },
      { t: 'kill', at: [2.1990, 41.3865], who: ['porter'], guards: 2, text: 'Encárgate del Armario y de sus porteros.' },
    ],
    outro: [['dj', '¡Esta va por el de Terrassa y por el Armario, que en paz descanse! ¡Unts unts unts!']],
    reward: 3000,
  },
  // ======================================================================= ACTO IV · PEDRALBES
  {
    id: 'glories', act: 'ACTO IV · PEDRALBES', title: 'VISTAS DESDE LO ALTO', giver: 'enric', room: 'mansion',
    intro: [
      ['enric', 'Usted es el chico de Terrassa. Qué exótico. Mi bisabuelo tenía allí fábricas textiles. Y niños dentro.'],
      ['pau', 'Usted dirá, marqués.'],
      ['enric', 'Hay un maletín en la azotea de la Torre Glòries. Súbase a mi helicóptero de la Plaça de Catalunya.'],
      ['majordom', 'El señor marqués ruega que no se estrelle contra la Sagrada Família. Ya bastante tardan en acabarla.'],
    ],
    steps: [
      { t: 'goto', at: [2.1712, 41.3866], text: 'Ve al helicóptero de la Plaça de Catalunya y súbete.', heli: true },
      { t: 'goto', at: [2.1897, 41.4034], text: 'Aterriza en la azotea de la Torre Glòries.', heli: true, roof: true, r: 25 },
      { t: 'goto', at: [2.1744, 41.4040], text: 'Ahora bájalo a la calle junto a la Sagrada Família.', heli: true, r: 40 },
    ],
    outro: [['obrer-sf', 'Ostras, un helicóptero. ¿Viene a acabar las torres? Porque nosotros no llegamos ni a 2080.']],
    reward: 3000,
  },
  {
    id: 'regidor', act: 'ACTO IV · PEDRALBES', title: 'EL REGIDOR', giver: 'enric', room: 'mansion',
    intro: [
      ['enric', 'El regidor Mas i Serrat no entiende que mis terrenos de Collserola tienen que ser hoteles de lujo.'],
      ['pau', '¿Y cómo se lo explico?'],
      ['enric', 'Llévelo de paseo al Tibidabo. Desde allí arriba todo se ve más claro. Sobre todo la caída.'],
      ['camilo', 'El sobre para el regidor ya está en Andorra. El regidor, todavía no. Depende de usted.'],
    ],
    steps: [
      { t: 'escort', who: 'regidor', at: [2.1190, 41.4218], text: 'Recoge al regidor en la Plaça de Sant Jaume y súbelo al Tibidabo.' },
      { t: 'talk', lines: [['regidor', '¡Vale, vale! La recalificación sale el lunes. Y el martes os dejo hacer un hotel en el Park Güell.'], ['pau', 'Muy bien, regidor. Ahora, a la noria.'], ['regidor', '¡Tengo vértigo!'], ['pau', 'Mejor. Así se acordará.']] },
      { t: 'escape', stars: 2, text: 'Alguien ha avisado a los Mossos. Piérdelos.' },
    ],
    outro: [['enric', 'Excelente. La democracia es maravillosa cuando sabes cuánto cuesta.']],
    reward: 4000,
  },
  {
    id: 'liceu', act: 'ACTO IV · PEDRALBES', title: 'NIT AL LICEU', giver: 'enric', room: 'mansion',
    intro: [
      ['enric', 'Esta noche subastan en el Liceu un cuadro de mi bisabuelo. Lo robó él, así que es mío por tradición.'],
      ['pau', '¿Comprarlo?'],
      ['enric', 'Joven, por favor. Los Montcada no compramos. Los Montcada heredamos, recalificamos y, en caso de duda, robamos.'],
    ],
    steps: [
      { t: 'pickup', at: [2.1735, 41.3805], text: 'Entra por la puerta de artistas del Liceu y coge el cuadro.', stars: 3 },
      { t: 'escape', stars: 3, text: 'Escapa de la policía con el cuadro.' },
      { t: 'goto', at: [2.1150, 41.3920], text: 'Llévalo a la mansión de Pedralbes.' },
    ],
    outro: [['majordom', 'El señor marqués está muy satisfecho. Ha sonreído. Por primera vez desde que se murió su esposa. Él la empujó.']],
    reward: 6000,
  },
  // ======================================================================= ACTO V · EL PORT
  {
    id: 'contenidors', act: 'ACTO V · EL PORT', title: 'CONTENEDORES', giver: 'mascarell', room: 'taller',
    intro: [
      ['mascarell', 'Así que tú eres el chaval de la Remei. La Remei me debe más que tu prima a ella.'],
      ['pau', 'Esto es una pirámide de deudas, ¿no?'],
      ['mascarell', 'Esto es Barcelona, chaval. Aquí hasta el alcalde está hipotecado. Los del Ruso descargan en mi muelle: tres furgonetas negras.'],
      ['driss', 'Y llevan mercancía que no ha pasado por mi báscula. Eso, en este puerto, es pecado mortal.'],
    ],
    steps: [
      { t: 'destroy', at: [2.1780, 41.3690], kind: 'van', color: '#2a2a3a', count: 3, text: 'Destruye las tres furgonetas negras del Ruso en el puerto.' },
    ],
    outro: [['estibador', 'Eso ha sonado hasta en Montjuïc. Los del crucero han aplaudido: pensaban que era un espectáculo incluido.']],
    reward: 5000,
    time: 240,
  },
  {
    id: 'rus', act: 'ACTO V · EL PORT', title: 'EL YATE DEL RUSO', giver: 'mascarell', room: 'taller',
    intro: [
      ['mascarell', 'El Ruso se ha cabreado. Está en su yate del Port Vell con cuatro matones y una tarta de cumpleaños.'],
      ['pau', 'Y quieres que vaya a felicitarle.'],
      ['mascarell', 'Quiero que sea su último cumpleaños. Y tráeme un trozo de tarta, que es de la Escribà.'],
    ],
    steps: [
      { t: 'kill', at: [2.1850, 41.3760], who: ['ruso'], guards: 4, text: 'Acaba con el Ruso y sus guardaespaldas en el Port Vell.' },
      { t: 'escape', stars: 3, text: 'Huye del puerto.' },
    ],
    outro: [['mascarell', 'El puerto vuelve a ser nuestro. Los peces de la Barceloneta comerán bien esta semana. Buen chaval.']],
    reward: 7000,
  },
  // ======================================================================= ACTO VI · NOU BARRIS
  {
    id: 'petanca', act: 'ACTO VI · NOU BARRIS', title: 'PETANCA I PÓLVORA', giver: 'montse', room: 'bar',
    intro: [
      ['montse', 'Nen, ¿tú eres el nieto del Quim de Terrassa? Ese hombre bailaba como nadie. Y robaba como nadie también.'],
      ['pau', 'Eso dice él.'],
      ['montse', 'Los matones del Rayo quieren convertir nuestro casal en un gimnasio de crossfit. Antes muerta. Antes ellos muertos, mejor.'],
      ['yeison', 'Iaia, yo le cubro. Desde Ciutat Meridiana se ve todo: cuesta arriba, pero todo.'],
    ],
    steps: [
      { t: 'kill', at: [2.1780, 41.4385], who: ['gimnasta'], guards: 4, text: 'Defiende la pista de petanca de los matones del Rayo.' },
    ],
    outro: [['petanca', 'Y yo con una bola de petanca de setecientos gramos y la cadera de titanio. Que conste en acta.']],
    reward: 4000,
  },
  {
    id: 'meridiana', act: 'ACTO VI · NOU BARRIS', title: 'LA MERIDIANA', giver: 'montse', room: 'bar',
    intro: [
      ['montse', 'El Rayo dice que es el más rápido de la Meridiana. Demuéstrale que no. Y si se mata en la carrera, mejor: me ahorro el entierro.'],
      ['rival-meridiana', 'De la Sagrera a Montcada. Si ganas, Nou Barris es tuyo. Si pierdes, tu coche, tu novia y tu riñón izquierdo son míos.'],
      ['rachid', 'Y tú, Rayo, me debes un coche desde 2021. Hoy lo pagas.'],
    ],
    steps: [
      { t: 'race', pts: [[2.1900, 41.4220], [2.1870, 41.4300], [2.1830, 41.4370], [2.1790, 41.4440], [2.1755, 41.4500]], text: 'Gana la carrera por la Meridiana.', time: 120 },
    ],
    outro: [['rival-meridiana', 'Vale, vale... eres rápido para ser de Terrassa. ¿El riñón te lo puedo pagar a plazos?']],
    reward: 5000,
  },
  // ======================================================================= FINAL
  {
    id: 'cop', act: 'FINAL', title: 'EL GRAN GOLPE', giver: 'remei', room: 'bar',
    intro: [
      ['remei', 'Pau, la deuda está pagada. Pero tengo un último encargo. Uno grande.'],
      ['pau', 'En las películas, el último encargo siempre acaba mal.'],
      ['remei', 'Esto no es una película, cariño: es Barcelona. Aquí todo acaba mal, pero con vistas al mar.'],
      ['remei', 'Un maletín con el dinero de todos: el Marqués, el Capità y el hipster. En el Moll d\'Espanya. Es tuyo si lo sacas de Barcelona.'],
      ['nadia', 'Como abogada te aconsejo que no lo hagas. Como amiga, que lo hagas rápido.'],
    ],
    steps: [
      { t: 'pickup', at: [2.1835, 41.3755], text: 'Recoge el maletín en el Moll d\'Espanya.', stars: 3 },
      { t: 'escape', stars: 3, text: 'Despista a la policía.' },
      { t: 'goto', at: [2.0068, 41.5628], text: 'Vuelve a casa: Rambleta del Pare Alegre, Terrassa.' },
    ],
    outro: [
      ['tete', '¿Esto es... todo para nosotros?'],
      ['pau', 'Para nosotros, para el avi y para pagarle al Nando el coche. Y el del maletero.'],
      ['karim', 'Con esto en Barcelona te da para la fianza de un estudio de treinta metros. Mejor quedaos en Terrassa.'],
      ['tete', 'Pau... ¿te puedo pedir un préstamo?'],
    ],
    reward: 50000,
  },
];
