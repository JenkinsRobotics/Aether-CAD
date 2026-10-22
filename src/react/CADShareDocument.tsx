import { useState } from "react";
import { Button, Dialog, TextField } from "@aether/ui";
import { documentLink } from "../document-link";

/** Uses the actual saved-document address; local files never imply hosted edits. */
export function CADShareDocument({onClose}:{onClose:()=>void}) {
  const link=documentLink(location.href), [message,setMessage]=useState("");
  return <Dialog open title="Share document" onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
    <div style={{display:"grid",gap:12,width:"min(440px,65vw)"}}>
      {link ? <><p>Recipients need existing access to this document.</p><TextField aria-label="Document link" value={link} readOnly onFocus={event=>event.currentTarget.select()}/><Button onClick={async()=>{try{await navigator.clipboard.writeText(link);setMessage("Link copied");}catch{setMessage("Select and copy the link above.");}}}>Copy link</Button></> : <p>Save this local document to Aether Studio to create a shareable document link.</p>}
      <span role="status">{message}</span>
    </div>
  </Dialog>;
}
