FROM python:3.11-slim

WORKDIR /app

COPY mcp/requirements-fastmcp.txt mcp/requirements-fastmcp.txt
RUN pip install --no-cache-dir -r mcp/requirements-fastmcp.txt

COPY mcp/ mcp/

COPY mcp/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PYTHONPATH=mcp
ENV FASTMCP_HOST=0.0.0.0
ENV FASTMCP_PORT=8000

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
