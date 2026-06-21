import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { CsvHandlerService } from '../../../../services/csv-handler';

@Component({
  selector: 'app-file-uploader',
  imports: [
CommonModule
  ],
  templateUrl: './file-uploader.component.html',
  styleUrl: './file-uploader.component.css'
})
export class FileUploaderComponent {

  csvHandlerService = inject(CsvHandlerService);
  
  file: File | null = null;
  uploading = false;
  uploadProgress = 0;
  uploadStatus: 'idle' | 'success' | 'error' = 'idle';

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.file = input.files[0];
      this.uploadStatus = 'idle';
    }
  }

  async onUpload(): Promise<void> {
    if (!this.file) return;

    this.uploading = true;
    this.uploadProgress = 0;

    /*
    // Simulating upload process
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 10));
      this.uploadProgress = i;
    }
    */

    const reader = new FileReader();
  
    reader.onload = (e: any) => {
      const csvData: string = e.target.result;
      this.csvHandlerService.setCsv(csvData)
      this.uploading = false;
      this.uploadStatus = 'success'
    };

    reader.onerror = () => {
      this.uploading = false;
      this.uploadStatus = 'error';
    };

    reader.readAsText(this.file);



  }
}
