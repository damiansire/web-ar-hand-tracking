import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CsvHandlerService } from '../../services/csv-handler';
import { FileUploaderComponent } from "./components/file-uploader/file-uploader.component";
import { DataHandleTableComponent } from "./components/data-handle-table/data-handle-table.component";

@Component({
  selector: 'app-data-importer',
  imports: [FileUploaderComponent, DataHandleTableComponent],
  templateUrl: './data-importer.component.html',
  styleUrl: './data-importer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DataImporterComponent {
  
  csvHandlerService = inject(CsvHandlerService);

}
