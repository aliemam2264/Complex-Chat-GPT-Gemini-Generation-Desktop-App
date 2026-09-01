export {};

declare global {
  interface Window {
    eskanderStudio?: {
      platform: string;
      desktop: boolean;
      apiUrl: string;

      saveImage: (
        imageUrl: string,
        fileName: string,
      ) => Promise<{
        success: boolean;
        canceled?: boolean;
        filePath?: string;
      }>;

      copyImage: (imageUrl: string) => Promise<{
        success: boolean;
      }>;

      prepareImageDrag: (
        imageUrl: string,
        fileName: string,
      ) => Promise<{
        success: boolean;
        filePath: string;
        iconPath?: string | null;
      }>;

      startImageDrag: (filePath: string, iconPath?: string | null) => void;
    };
  }
}
