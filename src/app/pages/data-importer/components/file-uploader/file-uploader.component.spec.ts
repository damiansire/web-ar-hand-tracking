import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileUploaderComponent } from './file-uploader.component';

describe('FileUploaderComponent', () => {
  let component: FileUploaderComponent;
  let fixture: ComponentFixture<FileUploaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileUploaderComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FileUploaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('rechaza archivos que superan el tamaño máximo', () => {
    const bigFile = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(bigFile, 'size', { value: component.maxFileSizeBytes + 1 });
    const event = { target: { files: [bigFile] } } as unknown as Event;

    component.onFileSelected(event);

    expect(component.file).toBeNull();
    expect(component.uploadStatus).toBe('error');
    expect(component.errorMessage).toContain('5MB');
  });

  it('marca el estado de error y libera el uploading si la lectura falla', async () => {
    const fakeReader: any = {
      onload: null,
      onerror: null,
      readAsText() {
        this.onerror(new Error('read failed'));
      },
    };
    spyOn(window as any, 'FileReader').and.returnValue(fakeReader);

    component.file = new File(['a,b'], 'test.csv', { type: 'text/csv' });
    await component.onUpload();

    expect(component.uploading).toBeFalse();
    expect(component.uploadStatus).toBe('error');
  });
});
