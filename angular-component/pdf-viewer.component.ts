import { Component, OnInit, ElementRef, ViewChild, ViewEncapsulation, HostListener } from '@angular/core';

declare var pdfjsLib: any;
declare var LeaderLine: any;

@Component({
  selector: 'app-pdf-viewer',
  templateUrl: './pdf-viewer.component.html',
  styleUrls: ['./pdf-viewer.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class PdfViewerComponent implements OnInit {
  pdfPath = 'raj_PDF3.pdf';
  jsonPath = 'content-understanding.json';
  scale = 1.5;
  pointsPerInch = 72;

  pdfDoc: any = null;
  jsonData: any = null;
  fields: any[] = [];
  sidebarGroups: { [key: string]: any[] } = {};
  sidebarGroupKeys: string[] = [];
  overlays: { [key: number]: HTMLElement } = {};
  pageDimensions: any = {};
  markdownContent = '';

  activeLeaderLine: any = null;
  tooltipHideTimeout: any = null;

  tooltipVisible = false;
  tooltipField: any = null;
  tooltipLeft = 0;
  tooltipTop = 0;
  saveBtnText = 'Save';
  saveBtnStyle: any = {};
  showCheckmarks = false;

  @ViewChild('pdfContainer', { static: true }) pdfContainer!: ElementRef;

  constructor(private el: ElementRef) {}

  ngOnInit() {
    this.loadData();
  }

  @HostListener('window:resize')
  onResize() {
    if (this.activeLeaderLine) {
      this.activeLeaderLine.position();
    }
  }

  @HostListener('document:scroll', ['$event'])
  onDocumentScroll(event: Event) {
    if (this.activeLeaderLine) {
      this.activeLeaderLine.position();
    }
  }

  onScroll() {
    if (this.activeLeaderLine) {
      this.activeLeaderLine.position();
    }
  }

  calculatePDI(pageInfo: any) {
    return {
      widthPoints: pageInfo.width * this.pointsPerInch,
      heightPoints: pageInfo.height * this.pointsPerInch,
      widthPixels: pageInfo.width * this.pointsPerInch * this.scale,
      heightPixels: pageInfo.height * this.pointsPerInch * this.scale,
    };
  }

  async loadData() {
    try {
      const [jsonResponse, pdfResponse] = await Promise.all([
        fetch(this.jsonPath),
        fetch(this.pdfPath),
      ]);

      this.jsonData = await jsonResponse.json();
      const contents = this.jsonData.result.contents[0];
      this.markdownContent = contents.markdown || "";

      this.pageDimensions = (contents.pages || []).reduce((acc: any, page: any) => {
        acc[page.pageNumber] = page;
        return acc;
      }, {});

      const pdfArrayBuffer = await pdfResponse.arrayBuffer();
      this.pdfDoc = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;

      this.parseFields();
      await this.renderPDF();
      this.populateSidebar();
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  parseFields() {
    const contents = this.jsonData.result.contents[0];
    const allFields = contents.fields;

    const flattenFields = (obj: any, prefix = "") => {
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === "object") {
          if (obj[key].source) {
            this.fields.push({
              key: prefix + key,
              ...obj[key],
              sourceData: this.parseSourceData(obj[key].source),
              hovered: false,
              selected: false
            });
          } else if (obj[key].valueArray) {
            obj[key].valueArray.forEach((item: any, index: number) => {
              if (item.valueObject) {
                flattenFields(item.valueObject, `${prefix}${key}[${index}].`);
              }
            });
          } else if (obj[key].valueObject) {
            flattenFields(obj[key].valueObject, `${prefix}${key}.`);
          } else {
            flattenFields(obj[key], `${prefix}${key}.`);
          }
        }
      }
    };

    flattenFields(allFields);
  }

  parseSourceData(sourceStr: string) {
    const match = sourceStr.match(
      /D\((\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/,
    );
    if (!match) return null;

    const page = parseInt(match[1], 10);
    const coords = match.slice(2).map(parseFloat);
    const xs = [coords[0], coords[2], coords[4], coords[6]];
    const ys = [coords[1], coords[3], coords[5], coords[7]];
    const pageInfo = this.pageDimensions[page] || { width: 8.5, height: 11 };
    const pdi = this.calculatePDI(pageInfo);
    const pageHeightPoints = pdi.heightPoints;

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const x = xMin * this.pointsPerInch * this.scale;
    const y = (pageHeightPoints - yMax * this.pointsPerInch) * this.scale;
    const width = (xMax - xMin) * this.pointsPerInch * this.scale;
    const height = (yMax - yMin) * this.pointsPerInch * this.scale;

    return {
      page,
      x,
      y,
      width,
      height,
      points: coords,
      pageInfo,
    };
  }

  async renderPDF() {
    const container = this.pdfContainer.nativeElement;
    container.innerHTML = "";
    this.overlays = {};

    for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale });

      const pageDiv = document.createElement("div");
      pageDiv.className = "pdf-page";
      pageDiv.id = `page-${pageNum}`;

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      canvas.id = `canvas-${pageNum}`;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport }).promise;

      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.style.width = `${viewport.width}px`;
      overlay.style.height = `${viewport.height}px`;

      pageDiv.appendChild(canvas);
      pageDiv.appendChild(overlay);
      container.appendChild(pageDiv);

      this.overlays[pageNum] = overlay;
    }

    this.addBoundingBoxes();
  }

  addBoundingBoxes() {
    this.fields.forEach((field) => {
      if (!field.sourceData) return;

      const { page } = field.sourceData;
      const overlay = this.overlays[page];
      let a = field.sourceData.points.map((d: number) => d * 108);
      if (!overlay) return;

      const box = document.createElement("div");
      box.className = "bounding-box";
      box.id = `box-${field.key}`;
      box.style.left = `${a[0]}px`;
      box.style.top = `${a[1]}px`;
      box.style.width = `${a[2] - a[0]}px`;
      box.style.height = `${a[5] - a[3]}px`;

      if (field.confidence < 0.5) {
        box.classList.add("confidence-low");
      } else if (field.confidence < 0.8) {
        box.classList.add("confidence-medium");
      } else {
        box.classList.add("confidence-high");
      }

      box.addEventListener("mouseenter", () => this.handleHover(field.key));
      box.addEventListener("mouseleave", () => this.handleUnhover(field.key));

      overlay.appendChild(box);
    });
  }

  populateSidebar() {
    this.sidebarGroups = {};
    this.fields.forEach((field) => {
      const category = field.key.split(".")[0];
      if (!this.sidebarGroups[category]) this.sidebarGroups[category] = [];
      this.sidebarGroups[category].push(field);
    });
    this.sidebarGroupKeys = Object.keys(this.sidebarGroups);
  }

  getLabel(key: string) {
    return key.split(".").pop();
  }

  updateFieldValue(field: any, event: any) {
    field.valueString = event.target.value;
  }

  highlightField(key: string) {
    document.querySelectorAll(".bounding-box.highlighted").forEach((box) => {
      box.classList.remove("highlighted");
    });
    this.fields.forEach(f => f.selected = false);

    const box = document.getElementById(`box-${key}`);
    const field = this.fields.find(f => f.key === key);

    if (box) {
      box.classList.add("highlighted");
      const pageNum = box.closest(".pdf-page")!.id.split("-")[1];
      document.getElementById(`page-${pageNum}`)!.scrollIntoView({ behavior: "smooth" });
    }

    if (field) field.selected = true;
  }

  handleHover(key: string) {
    clearTimeout(this.tooltipHideTimeout);
    const box = document.getElementById(`box-${key}`);
    const field = this.fields.find(f => f.key === key);
    
    if (box) box.classList.add("hovered");
    if (field) field.hovered = true;
    
    const item = this.el.nativeElement.querySelector(`[data-key="${key}"]`);
    
    if (box && item) {
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      this.createHoverLeaderLine(item, box);
    }

    this.showTooltip(key, box);
  }

  handleUnhover(key: string) {
    const box = document.getElementById(`box-${key}`);
    const field = this.fields.find(f => f.key === key);
    
    if (box) box.classList.remove("hovered");
    if (field) field.hovered = false;
    
    this.removeHoverLeaderLine();

    this.tooltipHideTimeout = setTimeout(() => {
      this.hideTooltip();
    }, 200);
  }

  createHoverLeaderLine(startElement: HTMLElement, endElement: HTMLElement) {
    this.removeHoverLeaderLine();
    if (typeof LeaderLine === 'undefined' || !startElement || !endElement) return;

    this.activeLeaderLine = new LeaderLine(startElement, endElement, {
      path: "fluid",
      startSocket: "right",
      endSocket: "left",
      color: "#00aaff",
      size: 2,
      dash: { animation: true },
      gradient: true,
      startPlug: "disc",
      endPlug: "arrow1",
    });
  }

  removeHoverLeaderLine() {
    if (this.activeLeaderLine) {
      this.activeLeaderLine.remove();
      this.activeLeaderLine = null;
    }
  }

  showTooltip(key: string, boxElement: HTMLElement | null) {
    if (!boxElement) return;

    const field = this.fields.find(f => f.key === key);
    if (!field) return;

    this.tooltipField = field;

    const pageOverlay = boxElement.closest('.pdf-page')!.querySelector('.overlay') as HTMLElement;
    
    const tooltipNode = this.el.nativeElement.querySelector('.bounding-box-tooltip');
    if (tooltipNode && tooltipNode.parentElement !== pageOverlay) {
      pageOverlay.appendChild(tooltipNode);
    }
    
    const left = parseFloat(boxElement.style.left) + parseFloat(boxElement.style.width) / 2;
    const top = parseFloat(boxElement.style.top);

    this.tooltipLeft = left;
    this.tooltipTop = top - 8;
    this.tooltipVisible = true;
  }

  hideTooltip() {
    this.tooltipVisible = false;
  }

  onTooltipEnter() {
    clearTimeout(this.tooltipHideTimeout);
  }

  onTooltipLeave() {
    this.tooltipHideTimeout = setTimeout(() => {
      this.hideTooltip();
    }, 200);
  }

  saveTooltip() {
    this.saveBtnText = "Saved!";
    this.saveBtnStyle = { backgroundColor: "#28a745" };

    setTimeout(() => {
      this.hideTooltip();
      this.saveBtnText = "Save";
      this.saveBtnStyle = {};
    }, 600);
  }

  toggleCheckmarks() {
    this.showCheckmarks = !this.showCheckmarks;
  }
}
