import test from "node:test";
import assert from "node:assert/strict";
import { requireDocumentWorkflow, TABLES, tableName, ident, editable, visible, validateFields, authorize, validId, type Column, type Role } from "../server/smartproPolicy.ts";

const columns:Column[]=[
  {name:"id",type:"int",nullable:false,autoIncrement:true,maxLength:null,hasDefault:false,defaultValue:null},
  {name:"name",type:"text",nullable:false,autoIncrement:false,maxLength:65535,hasDefault:false,defaultValue:null},
  {name:"price",type:"varchar",nullable:false,autoIncrement:false,maxLength:50,hasDefault:true,defaultValue:"0"},
  {name:"quantity",type:"int",nullable:false,autoIncrement:false,maxLength:null,hasDefault:false,defaultValue:null},
  {name:"date",type:"date",nullable:true,autoIncrement:false,maxLength:null,hasDefault:false,defaultValue:null},
  {name:"password",type:"text",nullable:false,autoIncrement:false,maxLength:65535,hasDefault:false,defaultValue:null},
];
test("only 20 known SmartPro business tables can be addressed",()=>{
  assert.equal(TABLES.length,20);
  assert.equal(tableName("bill_details"),"bill_details");
  for(const attack of ["users;DROP TABLE accounts", "nasqo_audit_log", "__proto__", "nonexistent", null]){
    assert.throws(()=>tableName(attack));
  }
  assert.equal(ident("bill_details"),String.fromCharCode(96)+"bill_details"+String.fromCharCode(96));
  assert.throws(()=>ident("accounts;DROP"));
});
test("never expose or edit legacy insecure password data",()=>{
  assert.equal(visible(columns).some(c=>c.name==="password"),false);
  assert.equal(editable("users",columns).some(c=>c.name==="password"),false);
  assert.throws(()=>validateFields("users",columns,{password:"1234"}));
  assert.throws(()=>validateFields("products",columns,{id:1337}));
});
test("typed field validation and source-preserving unknown column rejection",()=>{
  assert.deepEqual(validateFields("products",columns,{name:"نقالة",price:"1200",quantity:"2",date:null}),{name:"نقالة",price:"1200",quantity:2,date:null});
  assert.throws(()=>validateFields("products",columns,{quantity:1.5}));
  assert.throws(()=>validateFields("products",columns,{quantity:"NaN"}));
  assert.throws(()=>validateFields("products",columns,{date:"01/11/2026"}));
  assert.throws(()=>validateFields("products",columns,{name:"x".repeat(65536)}));
  assert.throws(()=>validateFields("products",columns,{"name; --":"x"}));
  assert.throws(()=>validateFields("products",columns,{}));
});
test("admin full rights, editor write/no delete, viewer read only",()=>{
  const can:{[k in Role]:string[]}={admin:["read","create","update","delete","roles"],editor:["read","create","update"],viewer:["read"]};
  for(const role of ["admin","editor","viewer"] as const){
    for(const action of ["read","create","update","delete","roles"] as const){
      if(can[role].includes(action))assert.doesNotThrow(()=>authorize(role,action));
      else assert.throws(()=>authorize(role,action));
    }
  }
});
test("only positive numeric record identifiers are accepted",()=>{
  assert.equal(validId("145"),"145");
  for(const value of ["-1","0","2 OR 1=1","","../../users","12345678901234567890123"])assert.throws(()=>validId(value));
});

test("financial document rows cannot be changed outside atomic workflow",()=>{
  for(const table of ["bounds","bill_details","bill_details2","store_trans","trans_details","bin","prems"] as const) {
    assert.throws(()=>requireDocumentWorkflow(table));
  }
  assert.doesNotThrow(()=>requireDocumentWorkflow("accounts"));
  assert.doesNotThrow(()=>requireDocumentWorkflow("products"));
});
