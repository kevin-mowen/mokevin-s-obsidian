
# 数据库
## pandawiki数据库

- 数据库名称
	- panda-wiki
- 有关文档的相关数据库
	- knowledge_bases：wiki站
	
| 字段              | 类型          | 说明                            |
| --------------- | ----------- | ----------------------------- |
| id              | text        | 主键，知识库的唯一标识（UUID）             |
| name            | text        | 知识库名称                         |
| dataset_id      | text        | 指向==RAG 向量存储服务中的 Dataset ID== |
| access_settings | jsonb       | 访问设置（JSON格式，包含端口、域名、认证等配置）    |
| created_at      | timestamptz | 创建时间                          |
| update_at       | timesamptz  | 更新时间                          |
|                 |             |                               |

	- nodes（文档节点）
- 
	- node_releases
		- doc_id

- 相关服务

## RAG数据库
- 数据库名称：
	- raglite
- 相关数据表
	- datasets（数据集）

| 字段                   | 说明                  |
| -------------------- | ------------------- |
| id                   | Dataset唯一标识         |
| name                 | 名称（创建时使用UUID）       |
| embedding_model      | 使用的嵌入模型             |
| chunk_method         | 分块方式                |
| document_count       | 文档数量                |
| parser_config        | 解析配置（分块token数、分隔符等） |
| similarity_threshold | 相似度阈值               |
| chunk_count          | 总分块数                |


	- documents（文档元信息）
	- chunks（向量分块 + embedding）

- 相关服务
	- api


doc_id 是两边的关联字段：PandaWiki 的 node_releases.doc_id 指向 RAG 的 documents.id。 

