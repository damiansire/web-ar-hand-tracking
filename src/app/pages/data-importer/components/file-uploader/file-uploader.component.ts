import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CsvHandlerService } from '../../../../services/csv-handler';

@Component({
  selector: 'app-file-uploader',
  imports: [CommonModule],
  templateUrl: './file-uploader.component.html',
  styleUrl: './file-uploader.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploaderComponent {

  csvHandlerService = inject(CsvHandlerService);

  readonly maxFileSizeBytes = 5 * 1024 * 1024;
  private readonly allowedExtensions = ['.csv', '.txt'];

  file = signal<File | null>(null);
  uploading = signal(false);
  uploadProgress = signal(0);
  uploadStatus = signal<'idle' | 'success' | 'error'>('idle');
  errorMessage = signal('');
  isDragging = signal(false);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.acceptFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const dropped = event.dataTransfer?.files;
    if (dropped && dropped.length > 0) {
      this.acceptFile(dropped[0]);
    }
  }

  // Validacion compartida entre el input de archivo y el drag & drop.
  private acceptFile(selected: File): void {
    if (!this.hasAllowedExtension(selected)) {
      this.file.set(null);
      this.uploadStatus.set('error');
      this.errorMessage.set('Solo se admiten archivos .csv o .txt.');
      return;
    }
    if (selected.size > this.maxFileSizeBytes) {
      this.file.set(null);
      this.uploadStatus.set('error');
      this.errorMessage.set('El archivo supera el tamaño máximo de 5MB.');
      return;
    }
    this.file.set(selected);
    this.uploadStatus.set('idle');
    this.errorMessage.set('');
  }

  private hasAllowedExtension(file: File): boolean {
    const name = file.name.toLowerCase();
    return this.allowedExtensions.some((ext) => name.endsWith(ext));
  }

  async onUpload(): Promise<void> {
    const file = this.file();
    if (!file) return;

    this.uploading.set(true);
    this.uploadProgress.set(0);

    const reader = new FileReader();

    reader.onload = (e) => {
      const csvData = (e.target?.result as string) ?? '';
      this.csvHandlerService.setCsv(csvData);
      this.uploading.set(false);
      this.uploadProgress.set(100);
      this.uploadStatus.set('success');
    };

    reader.onerror = () => {
      this.uploading.set(false);
      this.uploadStatus.set('error');
    };

    reader.readAsText(file);
  }
}
