import { DriveBrowser, FileIcon, type DocumentConnection } from '@aether/ui';
import { isAetherCADFile } from "@aether/core/document/file-types";
import { driveRequest, editorURL, fileIcon, fileType, type DriveFile } from '@aether/session/library/drive-api';
import { createNativeFile } from '@aether/session/library/create-native-file';
import { ASSEMBLY_PART_MIME } from "../assembly/insertion-session";
import { navigateDocument } from '../document-navigation';

const createItems = [{ id: 'project', label: 'New Hybrid design…' }, { id: 'part', label: 'New Part design…' }, { id: 'assembly', label: 'New Assembly design…' }];

/** The Drive half of the standard Files panel, configured for CAD: designs open here, saved Parts drag into assemblies. */
export function CADDrive({ documentID, connection }: { documentID: string | null; connection: DocumentConnection }) {
  return <DriveBrowser documentID={documentID} app="cad" documentNoun="design" request={driveRequest} flush={connection.flush}
    describe={file => ({ icon: <FileIcon icon={fileIcon(file as DriveFile)}/>, type: fileType(file as DriveFile) })}
    onOpen={file => navigateDocument(editorURL(file as DriveFile))}
    createItems={createItems}
    onCreate={async (kind, name, destination) => { await navigateDocument(editorURL(await createNativeFile<DriveFile>('cad', kind, name, destination, 'drive'))); }}
    draggable={file => file.kind === 'file' && isAetherCADFile(file.name)}
    onFileDragStart={(event, file) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(ASSEMBLY_PART_MIME, JSON.stringify({ kind: 'saved-part', fileId: file.id, revision: file.revision }));
    }}/>;
}
