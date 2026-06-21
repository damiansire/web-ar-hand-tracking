# TestCaseManager

Aplicacion Angular para **importar y visualizar archivos CSV**. Al cargar un
archivo, la app auto-detecta el delimitador (`,`, `;`, tab o `|`) y el salto de
linea, parsea el contenido (con soporte para campos entrecomillados segun
RFC 4180) y lo muestra en una tabla. Permite seleccionar filas y persiste el
ultimo archivo cargado en `localStorage`, de modo que el trabajo se conserva
entre recargas.

## Instalacion

```bash
npm install
```

## Uso

Levantar el servidor de desarrollo (`http://localhost:4200/`):

```bash
npm start
```

### Scripts disponibles

| Script                 | Descripcion                                              |
| ---------------------- | -------------------------------------------------------- |
| `npm start`            | Servidor de desarrollo con recarga en caliente.          |
| `npm run build`        | Build de produccion en `dist/`.                          |
| `npm test`             | Tests unitarios con Karma + Jasmine.                     |
| `npm run lint`         | Linter (ESLint + angular-eslint).                        |
| `npm run format`       | Formatea el codigo con Prettier.                         |
| `npm run format:check` | Verifica el formato sin escribir cambios.                |

## Stack tecnologico

- **Angular 19** (componentes standalone, signals, `ChangeDetectionStrategy.OnPush`)
- **TypeScript**
- **Tailwind CSS** para los estilos
- **ESLint** + **angular-eslint** para linting
- **Prettier** para formateo
- **Karma** + **Jasmine** para tests unitarios
