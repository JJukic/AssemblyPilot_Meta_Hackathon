export interface ReferenceImage {
  id: string;
  owner_type: "block" | "step";
  owner_id: string;
  url: string;
  original_filename: string;
  mime_type: string;
  width: number;
  height: number;
  created_at: string;
}

export interface BlockInput {
  name: string;
  description: string | null;
  category: string;
  color: string;
  shape: string;
  studs_x: number | null;
  studs_y: number | null;
  height_mm: number | null;
  default_quantity: number;
}

export interface BuildingBlock extends BlockInput {
  id: string;
  created_at: string;
  updated_at: string;
  reference_images: ReferenceImage[];
}
