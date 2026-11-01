# Roña — reglas (fuente de verdad del motor)

Roña usa la mecánica clásica de "virus contra órganos". Este documento es el contrato que implementa `shared/engine`.
Si el código y este documento no coinciden, el error está en el código.

## Cartas (68)

| Tipo | Color | Cantidad | Arte |
|---|---|---|---|
| organ | red, green, blue, yellow | 5 de cada uno | `organRed`… |
| organ | multi | 1 | `superOrgan` |
| virus | red, green, blue, yellow | 4 de cada uno | `ronaRed`… |
| virus | multi | 1 | `superRona` |
| medicine | red, green, blue, yellow | 4 de cada uno | `healRed`… |
| medicine | multi | 4 | `superHeal` |
| treatment `transplant` (Trasplante) | — | 3 | `starChangeOne` |
| treatment `thief` (Ladrón de órganos) | — | 3 | `starSteal` |
| treatment `contagion` (Contagio) | — | 2 | `starSneeze` |
| treatment `glove` (Guante de látex) | — | 1 | `starDrop` |
| treatment `medicalError` (Error médico) | — | 1 | `starChangeAll` |

Colores: red = corazón, green = pulmón, blue = cerebro, yellow = hueso. `multi` = comodín.

Cada carta tiene un `id` único (`c01`…`c68`), que es estable durante la partida.

## Preparación

- De 2 a 6 jugadores. Al empezar, el servidor baraja el orden de los asientos; luego se baraja el mazo, cada jugador recibe 3 cartas y empieza el primero del orden de asientos ya barajado.

## Cuerpo y estados de un órgano

El cuerpo de cada jugador es una lista de **ranuras** (slots). Cada ranura tiene `organ` (la carta), `viruses[]` y `medicines[]`, y su id es el id de la carta de órgano.

Estado derivado de cada ranura:
- `healthy`: sin virus ni medicinas.
- `infected`: 1 virus.
- `vaccinated`: 1 medicina.
- `immunized`: 2 medicinas. Es permanente: nada le afecta (ni virus, ni tratamientos).

En una ranura nunca conviven un virus y una medicina: se anulan entre sí (ver abajo).

**Un cuerpo no puede tener dos órganos del mismo color.** El órgano `multi` ocupa su propio "color" (`multi`), así que puede convivir con los cuatro colores normales.

## Turno

En su turno, el jugador hace **exactamente una** de estas dos cosas:
1. **Jugar** una carta de su mano.
2. **Descartar** de 1 a 3 cartas de su mano.

Luego roba hasta volver a tener 3 cartas y el turno pasa al siguiente jugador que siga en la partida (sólo se salta a los que salieron).
Un jugador desconectado no se salta: conserva su turno, que se resuelve por timeout de 8 s (descarta 1 carta al azar).
Si el mazo se acaba, se baraja el descarte y pasa a ser el nuevo mazo. Si aun así no alcanza, roba lo que haya.

## Compatibilidad de color

Un virus o una medicina de color X es compatible con un órgano de color Y si `X == Y`, si `X == multi` o si `Y == multi`.

Para curar un órgano infectado, la medicina debe ser compatible con el órgano **o** con el virus que lo infecta (una medicina `multi` cura cualquier cosa; un órgano infectado por un virus `multi` lo cura cualquier medicina compatible con el órgano).
Para destruir un órgano infectado, el segundo virus debe ser compatible con el órgano.
Para quitar una vacuna con un virus, el virus debe ser compatible con el órgano.

## Jugar cada tipo de carta

- **organ**: sólo en el cuerpo propio, y sólo si el jugador no tiene ya un órgano de ese color. Entra `healthy`.
- **virus** sobre un órgano compatible de **cualquier** jugador, incluido el propio (no es un movimiento útil, pero es legal):
  - `healthy` → `infected`.
  - `infected` → el órgano se **destruye**: el órgano y los dos virus van al descarte.
  - `vaccinated` → el virus y la medicina van al descarte y el órgano queda `healthy`.
  - `immunized` → ilegal.
- **medicine** sobre un órgano compatible del cuerpo **propio**:
  - `healthy` → `vaccinated`.
  - `vaccinated` → `immunized`.
  - `infected` → la medicina y el virus van al descarte y el órgano queda `healthy`.
  - `immunized` → ilegal.
- **transplant**: intercambia dos ranuras (el órgano con todo lo que tenga encima) entre **dos jugadores distintos**. Uno de ellos puede ser quien juega la carta. Ninguna de las dos ranuras puede estar `immunized`, y después del intercambio ningún cuerpo puede quedar con dos órganos del mismo color (sí se pueden intercambiar dos órganos del mismo color).
- **thief**: roba la ranura completa de otro jugador y la pasa al cuerpo propio. No puede estar `immunized`, y el ladrón no puede tener ya un órgano de ese color.
- **contagion**: el jugador pasa los virus de sus órganos infectados a órganos `healthy` (sin virus ni medicinas) de otros jugadores, siempre que el virus sea compatible con el órgano destino. Cada órgano destino recibe como mucho un virus. El jugador elige las asignaciones (`moves`); si no manda ninguna, el motor asigna automáticamente tantas como pueda. La carta se puede jugar aunque no mueva ningún virus.
- **glove**: todos los demás jugadores descartan su mano completa. **Pierden su siguiente turno**: cuando les toca, sólo roban 3 cartas y el turno pasa (el motor lo hace solo; se marca con `skipNext`).
- **medicalError**: intercambia el cuerpo completo con el de otro jugador.

Toda carta jugada, y todo lo que una carta destruye o anula, termina en el descarte.

## Victoria

Gana el primer jugador que tenga **4 órganos de distinto color que no estén infectados** (`healthy`, `vaccinated` o `immunized`). El órgano `multi` cuenta como uno de los cuatro. La victoria se comprueba después de **cada** acción y para **todos** los jugadores (con un Trasplante o un Error médico puede ganar alguien que no está jugando el turno). Si dos jugadores cumplen la condición a la vez, gana el que jugó la carta; si no está entre ellos, gana el primero en orden de asientos.

## Abandono

Si un jugador abandona la partida, sus cartas (mano y cuerpo) van al descarte y se le salta. Si queda un solo jugador activo, ese jugador gana por abandono (`reason: 'forfeit'`).
