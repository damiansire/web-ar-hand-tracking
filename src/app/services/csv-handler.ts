import { computed, effect, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { DataStorageSyncService } from './data-storage-sync.service';

// Orden de preferencia para auto-detectar el delimitador cuando el CSV
// contiene varios candidatos: la coma es el caso mas comun (RFC 4180).
const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;
const DEFAULT_DELIMITER = ',';
const DEFAULT_LINE_BREAK = '\n';

@Injectable({
  providedIn: 'root',
})
export class CsvHandlerService {

  dataStorageSyncService = inject(DataStorageSyncService);

  csvData = signal<string | null>(null);
  parsedData = signal<string[][] | null>(null);
  selectedRows = signal<number[]>([]);

  possibleDelimiters = computed(() => {
    const csvData = this.csvData();
    if (!csvData) {
      return null;
    }
    return DELIMITER_CANDIDATES.filter((d) => csvData.includes(d));
  });

  possibleLineBreaks = computed(() => {
    const csvData = this.csvData();
    if (!csvData) {
      return null;
    }
    if (csvData.includes('\r\n')) {
      return ['\r\n'];
    }
    const possibleLineBreaks = ['\n', '\r'];
    return possibleLineBreaks.filter((lb) => csvData.includes(lb));
  });

  // El delimitador/salto efectivos se auto-detectan a partir del CSV cargado
  // (el primer candidato presente, por orden de preferencia) y quedan como
  // valor por defecto. linkedSignal permite que el usuario los sobreescriba
  // desde la UI; al cargar un CSV nuevo se vuelve a recalcular el default.
  selectedDelimiter = linkedSignal<readonly string[] | null, string>({
    source: this.possibleDelimiters,
    computation: (candidates) => candidates?.[0] ?? DEFAULT_DELIMITER,
  });

  selectedLineBreak = linkedSignal<readonly string[] | null, string>({
    source: this.possibleLineBreaks,
    computation: (candidates) => candidates?.[0] ?? DEFAULT_LINE_BREAK,
  });

  setCsv(csvData: string) {
    this.csvData.set(csvData);
  }

  constructor() {
    this.loadFromLocalStorage()

    effect(() => {
      const csvData = this.csvData();
      if (csvData !== null) { 
        this.dataStorageSyncService.saveCurrentFile(csvData);
      }
    });
  }

  loadFromLocalStorage(){
    const currentFile = this.dataStorageSyncService.getCurrentFile();
    if(currentFile){
      this.csvData.set(currentFile);
    }
  }

  parseCSV(): void {
    if (!this.selectedDelimiter() || !this.selectedLineBreak() )
      return;

    const csvData = this.csvData();
    if(csvData != null){
      const parsedData = this.parseRows(
        csvData,
        this.selectedDelimiter(),
        this.selectedLineBreak(),
      );
      this.parsedData.set(parsedData);
      this.selectedRows.set([])
    }
  }

  // Parser CSV con soporte de campos entrecomillados (RFC 4180):
  // respeta el delimitador y el salto de linea dentro de comillas dobles y
  // las comillas escapadas ("").
  private parseRows(
    csvData: string,
    delimiter: string,
    lineBreak: string,
  ): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < csvData.length; i++) {
      const char = csvData[i];

      if (inQuotes) {
        if (char === '"') {
          if (csvData[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (delimiter && csvData.startsWith(delimiter, i)) {
        currentRow.push(field);
        field = '';
        i += delimiter.length - 1;
        continue;
      }

      if (lineBreak && csvData.startsWith(lineBreak, i)) {
        currentRow.push(field);
        rows.push(currentRow);
        currentRow = [];
        field = '';
        i += lineBreak.length - 1;
        continue;
      }

      field += char;
    }

    currentRow.push(field);
    rows.push(currentRow);
    return rows;
  }

  reset(): void {
    this.dataStorageSyncService.clearCurrentFile();
    this.csvData.set(null);
    this.parsedData.set(null);
    this.selectedRows.set([]);
  }

  toggleRowSelection(rowIndex: number): void {
    this.selectedRows.update((rows) => {
      const index = rows.indexOf(rowIndex);
      if (index === -1) {
        return [...rows, rowIndex]; 
      } else {
        return rows.filter((row) => row !== rowIndex); 
      }
    });
  }
}
