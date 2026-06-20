import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { findSpecialCharacters } from '../libs/text-helper';
import { LocalStorageService } from './local-storage.service';
import { DataStorageSyncService } from './data-storage-sync.service';

@Injectable({
  providedIn: 'root',
})
export class CsvHandlerService {

  dataStorageSyncService = inject(DataStorageSyncService);

  csvData = signal<string | null>(null);
  selectedDelimiter = signal(',');
  selectedLineBreak = signal('\n');
  parsedData = signal<string[][] | null>(null);
  selectedRows = signal<number[]>([]);

  possibleDelimiters = computed(() => {
    const csvData = this.csvData();
    if (!csvData) {
      return null;
    }
    const possibleDelimiters = [',', ';', '\t', '|'];
    return possibleDelimiters.filter((d) => csvData.includes(d));
  });

  possibleLineBreaks = computed(() => {
    const csvData = this.csvData();
    if (!csvData) {
      return null;
    }
    const possibleLineBreaks = ['\n', '\r\n', '\r'];
    return possibleLineBreaks.filter((lb) => csvData.includes(lb));
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
      const rows = csvData.split(this.selectedLineBreak());
      const parsedData = rows.map((row) => row.split(this.selectedDelimiter()));
      this.parsedData.set(parsedData);
      this.selectedRows.set([])
    }
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
