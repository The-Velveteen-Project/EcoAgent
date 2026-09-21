# Estado del release — ALLO / EcoAgent

Actualizado el 21-sep-2026. Solo contiene lo que se verificó ejecutándolo. Lo que no se pudo
verificar está marcado como tal. **Aún sin tag ni DOI** (ver «Pendiente»).

## 1. Commits publicados en `origin/main`

| Hash | Contenido |
|---|---|
| `a61120a` | H1 — explicador `/modelo`: SDE de Jacobi forzada por lluvia en vez de CIR; prompt extraído a función pura; test de invariantes (60 casos) |
| `23eefbd` | H2 — nomenclatura CIR → Jacobi en la capa TypeScript, con alias `@deprecated`; texto que lee el LLM; encabezado de `/clima` y menú `/ayuda` |
| `d39a5eb` | H3 — cadena de versión TS `jacobi_rainfall_forced_v2` → `_v3` y los 4 tests que la afirmaban |
| `0e62d11` | Licencia Apache-2.0: `LICENSE` literal (SHA-256 `cfc7749b…523d30`, el canónico de apache.org), `NOTICE` con titular, campo `license`, insignia y sección en el README |
| `b0e469d` | `CITATION.cff` (válido contra el esquema CFF 1.2.0 con `cffconvert`) y sección «How to cite» |
| `9522325` | Requisitos declarados: `engines` (Node ≥20 <23), `.nvmrc`, tablas de requisitos y de credenciales en el README |
| `15ab39d` | `evaluation/llm_fidelity/`: arnés, método, 596 filas por generación y resultados agregados |

Push normal, sin `--force`, sin reescritura de historia, sin tocar tags. GitHub detecta la licencia
como Apache-2.0. Los despliegues que dispara cada push (Railway para el bot, Vercel para la web)
terminaron en `success` para `0e62d11`.

## 2. Números verificados

| Afirmación | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio en cada uno de los commits H1, H2 y H3, exportados por separado |
| Suite TypeScript | **98/98**, 9 archivos, en cada uno de esos commits |
| Línea base antes de H1–H3 (`706bb52`) | **38/38**, 8 archivos |
| Test de invariantes | **60 casos**, pasa |
| Verificación por mutación del test de invariantes | 9 mutaciones del prompt, 9 detectadas: sigla CIR, nombre Cox-Ingersoll-Ross, mean-shift `b` +0,05/mm, «mean reversion», umbral 0,6, deriva `a(b − Rt)`, banda 0,70→0,75, ancla 300→350 mm, borrar FORCING |
| Suite Python del repo (motor v2) | 11/11 |
| Secretos en el historial (55 commits) | ninguno; el `.env` de `222bfb1`, borrado en `9bcca39`, solo tenía marcadores |
| Build de producción del bot (`npm ci --ignore-scripts` + `npm run build`) | pasa |

Las cifras 98, 38 y 60 del manuscrito son correctas **en `d39a5eb`**. Ver §4 sobre cómo cambian.

## 3. Lo que el repositorio todavía NO sostiene del manuscrito

**El motor Python del repo sigue siendo v2.** `eco-stochast-poc/python_engine/main.py` usa un
generador LCG, reporta como `prob_failure` la fracción de trayectorias cuyo pico supera Sc, usa un
humedecimiento exponencial y emite `jacobi_rainfall_forced_v2`; `config.py` conserva los parámetros
CIR `a`, `b`. La tabla de invariantes del manuscrito (filas 1, 4, 5 y 6) describe el motor v3.

El motor v3 existe (artefactos de Claude Science del 16-jul) y está preparado y probado en
`~/Personal/ALLO/ecoagent_v3_landing/` (ver su `LEEME.md`), pero **no está aplicado**: el
clasificador de permisos de la sesión de Claude Code bloqueó la sustitución de `main.py`. Aplicarlo
son dos comandos. Al ejecutarlo tal como fue escrito aparecieron cuatro defectos de integración,
todos corregidos y con test en el paquete:

1. La respuesta no traía `hazard_probability_mean`, que el Zod del bot exige: toda respuesta fallaba
   la validación y el failover respondía el 100 % de las veces, con solo un warn en el log.
2. `ALLO_H0` en `.env` tumbaba el servicio al importar (`extra_forbidden`).
3. ρ(R) recibía mm por bin en vez de mm/día: los mismos 120 mm/24 h daban pico S 0,63 en bins
   horarios y 0,83 en un bin diario.
4. Con el patrón de llamada del bot (24 bins horarios, 24 h) la alerta solo podía ser LOW: con S = 1
   todo el día, P = 0,103 < 0,15. Causa: la tabla de disparadores publicada se calculó sobre la
   probabilidad integrada a **25 días** (`memo_recalibracion.md`, l. 137) y el bot integra 24 h. El
   paquete declara `alert_horizon_days = 25` y aplica las bandas a esa probabilidad, bajo un supuesto
   de persistencia del hazard que hay que declarar en limitaciones. No cambia bandas (0,70/0,40/0,15),
   anclas (200/300/400 mm) ni parámetros del hazard.

Ensayo del paquete sobre una exportación de HEAD: TypeScript **102/102** (98 + 4 de contrato),
Python **39/39**, y llamada en vivo al servicio v3 con el `PythonJacobiEngine` real a través de
`FailoverSimulationEngine` (Zod acepta, responde el primario).

**Producción — no verificado desde Railway, inferido del registro público de deployments de GitHub.**
El único servicio que sigue a `main` es el bot. El segundo servicio de Railway se desplegó por última
vez el 2026-04-05 desde `8c5b26f`, cuando el Python era el CIR literal y devolvía cuatro claves que el
Zod actual rechaza. Si eso es el motor Python, en producción responde el fallback TypeScript siempre.
Hay que confirmarlo en el panel de Railway y, si se quiere que la frase «motor primario Python» del
manuscrito sea cierta, redesplegar ese servicio desde v3.

**Arnés de fidelidad.** El manuscrito dice que es «re-runnable end to end». Lo archivado es una
biblioteca (banco, turnos de chat, auditoría): las 596 generaciones se pueden re-auditar sin red,
pero el driver que llamó al modelo no está, así que no se pueden producir generaciones nuevas.

## 4. Correcciones que esto implica en el manuscrito

- Si se aplica el paquete v3, la suite TypeScript del tag será 102/102, no 98/98. Decir «98/98 en el
  commit de la corrección» o actualizar la cifra.
- Declarar la ventana de 25 días y el supuesto de persistencia.
- «Re-runnable end to end» → «re-auditable»; o añadir el driver.
- La frase sobre el motor primario desplegado, según lo que muestre Railway.
- El primario v3 y el fallback emiten ambos `jacobi_rainfall_forced_v3` con números distintos para la
  misma entrada, así que la cadena de versión no dice qué motor respondió. Conviene distinguirlas
  antes de instrumentar la tasa de failover.

## 5. Pendiente

| Qué | Quién | Por qué no está |
|---|---|---|
| Aplicar el paquete v3 al repo | Carlos (o conceder el permiso) | bloqueado por el clasificador de permisos |
| Activar la integración Zenodo–GitHub | Carlos, en el navegador | Zenodo solo archiva releases creados después de activarla |
| Tag `v1.0.0`, release, DOI; rellenar `doi` y `date-released` en `CITATION.cff` y el README | tras lo anterior | orden obligatorio |
| Versión: `package.json` dice 2.0.0, el FastAPI v3 dice 3.0.0 y el tag planeado es `v1.0.0` | decidir | `MODEL_CARD` dice «v1» y `web/package.json` 1.0.0; recomendado bajar `package.json` a 1.0.0 |
| `README.md` § Notes aún dice que el repo contiene «legacy stochastic engine components» | tras aplicar v3 | hoy es cierto |
| `docs/MODEL_CARD.md` invariante 6 define la probabilidad como «excedencia de Sc»; el manuscrito y v3 la definen como hazard-link | Carlos | es el documento de verdad científica; no se tocó |
