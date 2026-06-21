import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CsvHandlerService } from '../../../../services/csv-handler';

@Component({
  selector: 'app-data-handle-table',
  imports: [FormsModule],
  templateUrl: './data-handle-table.component.html',
  styleUrl: './data-handle-table.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataHandleTableComponent implements OnInit {
  csvHandlerService = inject(CsvHandlerService);

  headers = computed(() => this.csvHandlerService.parsedData()?.[0] ?? []);
  bodyRows = computed(() => this.csvHandlerService.parsedData()?.slice(1) ?? []);
  selectedCount = computed(() => this.csvHandlerService.selectedRows().length);

  ngOnInit() {
    this.csvHandlerService.parseCSV()
  }

  toggleRowSelection(rowIndex: number): void {
    this.csvHandlerService.toggleRowSelection(rowIndex)
  }

  // Permite seleccionar/deseleccionar una fila con teclado (Enter / Espacio),
  // equivalente al click. Evita el scroll por defecto del Espacio.
  onRowKeydown(event: KeyboardEvent, rowIndex: number): void {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.toggleRowSelection(rowIndex);
    }
  }

  loadAnotherFile(): void {
    this.csvHandlerService.reset()
  }
}
