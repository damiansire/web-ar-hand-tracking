import { Component, inject, OnInit, signal } from '@angular/core';
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
  headers = [
    'testId',
    'parentId',
    'Test Type',
    'Test Title',
    'Test Priority',
    'Scope',
    'Step',
  ];

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
