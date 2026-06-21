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

    expect(component.file()).toBeNull();
    expect(component.uploadStatus()).toBe('error');
    expect(component.errorMessage()).toContain('5MB');
  });

  it('rechaza archivos con extension no admitida', () => {
    const file = new File(['x'], 'imagen.png', { type: 'image/png' });
    const event = { target: { files: [file] } } as unknown as Event;

    component.onFileSelected(event);

    expect(component.file()).toBeNull();
    expect(component.uploadStatus()).toBe('error');
    expect(component.errorMessage()).toContain('.csv');
  });

  it('acepta un archivo valido soltado por drag & drop', () => {
    const file = new File(['a,b'], 'datos.csv', { type: 'text/csv' });
    const event = {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { files: [file] },
    } as unknown as DragEvent;

    component.onDrop(event);

    expect(component.file()).toBe(file);
    expect(component.isDragging()).toBeFalse();
    expect(component.uploadStatus()).toBe('idle');
  });

  it('rechaza por drag & drop un archivo demasiado grande', () => {
    const bigFile = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(bigFile, 'size', { value: component.maxFileSizeBytes + 1 });
    const event = {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { files: [bigFile] },
    } as unknown as DragEvent;

    component.onDrop(event);

    expect(component.file()).toBeNull();
    expect(component.uploadStatus()).toBe('error');
  });

  it('activa y desactiva el estado de arrastre', () => {
    const evt = { preventDefault() {}, stopPropagation() {} } as unknown as DragEvent;

    component.onDragOver(evt);
    expect(component.isDragging()).toBeTrue();

    component.onDragLeave(evt);
    expect(component.isDragging()).toBeFalse();
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

    component.file.set(new File(['a,b'], 'test.csv', { type: 'text/csv' }));
    await component.onUpload();

    expect(component.uploading()).toBeFalse();
    expect(component.uploadStatus()).toBe('error');
  });
});
