import { Component, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CsvHandlerService } from '../../../../services/csv-handler';

@Component({
  selector: 'app-data-handle-table',
  imports: [FormsModule],
  templateUrl: './data-handle-table.component.html',
  styleUrl: './data-handle-table.component.css',
})
export class DataHandleTableComponent implements OnInit {
  csvHandlerService = inject(CsvHandlerService);
  newColumnName: string = '';

  headers = computed(() => this.csvHandlerService.parsedData()?.[0] ?? []);
  bodyRows = computed(() => this.csvHandlerService.parsedData()?.slice(1) ?? []);

  ngOnInit() {
    this.csvHandlerService.parseCSV()
  }

  toggleRowSelection(rowIndex: number): void {
    this.csvHandlerService.toggleRowSelection(rowIndex)
  }

  loadAnotherFile(): void {
    this.csvHandlerService.reset()
  }
}
